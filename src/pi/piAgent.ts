/**
 * Subprocess backend that talks to the pi coding agent.
 *
 * The extension never talks to an LLM API directly. Instead it spawns the
 * locally installed `pi` CLI in non-interactive "print mode" and pipes the
 * code context through stdin. This gives us:
 *
 *   - pi's provider/model configuration (the user's `~/.pi/agent/settings.json`),
 *   - pi's authentication handling for those providers,
 *   - a real process handle we can kill when a request becomes stale.
 *
 * All invocations use a strict flag set that turns pi into a pure
 * text-in/text-out completion engine: no tools, no sessions, no extensions.
 * pi prints the final assistant text to stdout and exits.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { tmpdir } from "node:os";

/**
 * Signature of the spawn function used by runPiCompletion. Injectable so the
 * unit tests can fake the child process without launching anything real.
 */
export type SpawnFn = (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
) => ChildProcess;

/** How the pi CLI is launched, plus per-request limits. */
export interface PiRunnerConfig {
    /**
     * Command used to launch pi, e.g. `["pi"]` when the extension host runs
     * inside WSL, or `["wsl.exe", "-e", "pi"]` when it runs on Windows and
     * pi is installed inside WSL. The first element is the executable; the
     * remaining elements are passed before pi's own arguments.
     */
    command: string[];
    /**
     * Optional `--model` argument (e.g. "glm-5.3-flash-nvfp4").
     * Empty/undefined uses pi's configured default model.
     */
    model?: string;
    /** Hard limit in milliseconds before the pi process is killed. */
    timeoutMs: number;
    /** Replaces pi's coding-assistant system prompt with a completion prompt. */
    systemPrompt: string;
}

/** One completion request sent to pi. */
export interface PiCompletionRequest {
    /** Full prompt body piped to pi via stdin (the code context). */
    stdin: string;
    /**
     * Short instruction passed as the message argument. pi prepends piped
     * stdin to the first prompt, so the model sees `stdin + instruction`.
     */
    instruction: string;
}

/** Failure modes of a pi invocation. */
export type PiAgentErrorCode = "spawn" | "exit" | "timeout" | "abort";

/** Error thrown for every failure mode of a pi invocation. */
export class PiAgentError extends Error {
    constructor(
        readonly code: PiAgentErrorCode,
        message: string,
        /** Everything pi wrote to stderr, when available. */
        readonly stderr?: string,
    ) {
        super(message);
        this.name = "PiAgentError";
    }
}

/** True when `err` is a PiAgentError with the given code. */
export function isPiAgentError(err: unknown, code: PiAgentErrorCode): boolean {
    return err instanceof PiAgentError && err.code === code;
}

/**
 * Builds the argument vector (without the executable itself) for a pi
 * print-mode run. Exported so the tests can pin the exact flag contract.
 */
export function buildPiArgs(config: PiRunnerConfig, instruction: string): string[] {
    const args = [
        // Non-interactive: process the prompt, print the final answer, exit.
        "--print",
        // Ephemeral: never persist completion traffic as sessions.
        "--no-session",
        // Safety: a completion engine must never execute tools
        // (bash, edit, write, ...), no matter what the prompt asks for.
        "--no-tools",
        // Skip optional resource discovery: faster startup, deterministic runs.
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-themes",
        // Ignore trust-gated project-local files; cwd is neutral anyway.
        "--no-approve",
        // Replace the coding-assistant persona with the completion persona.
        "--system-prompt", config.systemPrompt,
    ];
    if (config.model) {
        args.push("--model", config.model);
    }
    // "--" ends option parsing so the instruction may start with a dash.
    args.push("--", instruction);
    return args;
}

/**
 * Runs one completion request through pi and resolves with pi's raw stdout
 * (the final assistant text, unprocessed). Rejects with a PiAgentError on
 * spawn failure, nonzero exit, timeout or abort.
 *
 * `signal` aborts the run: the child process is killed immediately, which
 * is what makes the provider's debounce cheap (no zombie LLM requests).
 */
export async function runPiCompletion(
    request: PiCompletionRequest,
    config: PiRunnerConfig,
    signal?: AbortSignal,
    spawnFn: SpawnFn = spawn,
): Promise<string> {
    if (config.command.length === 0) {
        throw new PiAgentError("spawn", "vscodeTabComplete.command must not be empty");
    }

    const executable = config.command[0];
    const leadingArgs = config.command.slice(1);

    let child: ChildProcess;
    try {
        child = spawnFn(executable, [...leadingArgs, ...buildPiArgs(config, request.instruction)], {
            // Neutral cwd: keeps project-local pi configuration and trust
            // prompts out of the run; completions must behave identically
            // no matter which workspace is open.
            cwd: tmpdir(),
            stdio: ["pipe", "pipe", "pipe"],
            // Avoid flashing a console window when hosted on Windows.
            windowsHide: true,
        });
    } catch (err) {
        throw new PiAgentError("spawn", `Failed to launch pi: ${errorMessage(err)}`);
    }

    return await new Promise<string>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let settled = false;

        // Single funnel so only the first outcome wins (e.g. timeout racing
        // with a normal exit) and every listener/timer is cleaned up once.
        const finish = (err?: PiAgentError) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            if (err) {
                reject(err);
            } else {
                resolve(stdout);
            }
        };

        child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
        });

        // EPIPE can happen when pi dies before consuming all of stdin; the
        // 'close'/'error' events below decide the outcome, so ignore it here.
        child.stdin?.on("error", () => {});
        child.stdin?.end(request.stdin);

        // Spawn failures (ENOENT, EACCES, ...) surface as an 'error' event.
        child.on("error", (err) => {
            finish(new PiAgentError("spawn", `Failed to launch pi: ${errorMessage(err)}`));
        });

        // 'close' (not 'exit') waits until the stdio streams are flushed.
        child.on("close", (code) => {
            if (code === 0) {
                finish();
            } else {
                finish(
                    new PiAgentError(
                        "exit",
                        `pi exited with code ${code ?? "unknown"}: ${stderr.trim() || "no stderr"}`,
                        stderr.trim(),
                    ),
                );
            }
        });

        // Kill the process when the request exceeds its time budget.
        const timer =
            config.timeoutMs > 0
                ? setTimeout(() => {
                      child.kill("SIGKILL");
                      finish(new PiAgentError("timeout", `pi did not answer within ${config.timeoutMs} ms`, stderr.trim()));
                  }, config.timeoutMs)
                : undefined;

        // Abort support: the provider aborts superseded and cancelled requests.
        const onAbort = () => {
            child.kill("SIGTERM");
            finish(new PiAgentError("abort", "pi completion was aborted"));
        };
        if (signal?.aborted) {
            onAbort();
        } else {
            signal?.addEventListener("abort", onAbort, { once: true });
        }
    });
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
