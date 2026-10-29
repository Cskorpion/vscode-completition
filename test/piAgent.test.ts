/**
 * Unit tests for the pi subprocess backend.
 *
 * The spawn function is injected, so these tests exercise the full request
 * lifecycle (stdin piping, stdout capture, timeouts, aborts, error paths)
 * without ever launching a real process or hitting an LLM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { tmpdir } from "node:os";
import {
    buildPiArgs,
    isPiAgentError,
    PiAgentError,
    runPiCompletion,
    type PiCompletionRequest,
    type PiRunnerConfig,
    type SpawnFn,
} from "../src/pi/piAgent";

/** Minimal ChildProcess stand-in: just the surface runPiCompletion touches. */
class FakeChildProcess extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly stdin = new PassThrough();
    killed = false;
    killCount = 0;
    lastSignal: string | undefined;

    kill(signal?: string): boolean {
        this.killed = true;
        this.killCount++;
        this.lastSignal = signal;
        return true;
    }
}

/** Creates a spawn fake that records invocations and returns controllable children. */
function makeFakeSpawn() {
    const children: FakeChildProcess[] = [];
    const invocations: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
    const stdinData: string[] = [];

    const spawnFn: SpawnFn = (command, args, options) => {
        invocations.push({ command, args, options });
        const child = new FakeChildProcess();
        // Attach before runPiCompletion writes, so the payload is captured.
        child.stdin.on("data", (chunk: Buffer) => stdinData.push(chunk.toString()));
        children.push(child);
        return child as unknown as ChildProcess;
    };

    return { children, invocations, stdinData, spawnFn };
}

const baseConfig: PiRunnerConfig = {
    command: ["pi"],
    model: undefined,
    timeoutMs: 60_000,
    systemPrompt: "sys",
};

const baseRequest: PiCompletionRequest = {
    stdin: "code context",
    instruction: "complete it",
};

test("buildPiArgs pins the strict, tool-free flag contract", () => {
    const args = buildPiArgs(baseConfig, "instruction");
    assert.deepEqual(args, [
        "--print",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-themes",
        "--no-approve",
        "--system-prompt", "sys",
        "--", "instruction",
    ]);
});

test("buildPiArgs adds --model only when configured", () => {
    const withModel = buildPiArgs({ ...baseConfig, model: "glm-5.3-flash-nvfp4" }, "instruction");
    assert.equal(withModel[withModel.indexOf("--model") + 1], "glm-5.3-flash-nvfp4");

    const withoutModel = buildPiArgs(baseConfig, "instruction");
    assert.ok(!withoutModel.includes("--model"));
});

test("runPiCompletion resolves with the full stdout", async () => {
    const fake = makeFakeSpawn();
    const promise = runPiCompletion(baseRequest, baseConfig, undefined, fake.spawnFn);

    const child = fake.children[0];
    child.stdout.write("hello\n");
    child.stdout.write("world");
    child.emit("close", 0);

    assert.equal(await promise, "hello\nworld");
});

test("runPiCompletion pipes the context through stdin", async () => {
    const fake = makeFakeSpawn();
    const promise = runPiCompletion(
        { stdin: "before <CURSOR> after", instruction: "instruction" },
        baseConfig,
        undefined,
        fake.spawnFn,
    );

    fake.children[0].emit("close", 0);
    await promise;

    assert.equal(fake.stdinData.join(""), "before <CURSOR> after");
});

test("runPiCompletion launches the configured command with a neutral cwd", async () => {
    const fake = makeFakeSpawn();
    const config: PiRunnerConfig = { ...baseConfig, command: ["wsl.exe", "-e", "pi"] };
    const promise = runPiCompletion(baseRequest, config, undefined, fake.spawnFn);

    const invocation = fake.invocations[0];
    assert.equal(invocation.command, "wsl.exe");
    assert.deepEqual(invocation.args.slice(0, 2), ["-e", "pi"]);
    assert.ok(invocation.args.includes("--print"));
    assert.equal(invocation.options.cwd, tmpdir());
    assert.equal(invocation.options.windowsHide, true);

    fake.children[0].emit("close", 0);
    await promise;
});

test("runPiCompletion rejects with stderr details on nonzero exit", async () => {
    const fake = makeFakeSpawn();
    const promise = runPiCompletion(baseRequest, baseConfig, undefined, fake.spawnFn);

    const child = fake.children[0];
    child.stderr.write("boom");
    child.emit("close", 1);

    await assert.rejects(promise, (err: unknown) => {
        assert.ok(err instanceof PiAgentError);
        assert.equal(err.code, "exit");
        assert.match(err.message, /code 1/);
        assert.match(err.message, /boom/);
        return true;
    });
});

test("runPiCompletion kills the process and rejects on timeout", async () => {
    const fake = makeFakeSpawn();
    const config: PiRunnerConfig = { ...baseConfig, timeoutMs: 20 };
    const promise = runPiCompletion(baseRequest, config, undefined, fake.spawnFn);

    const child = fake.children[0];
    await assert.rejects(promise, (err: unknown) => isPiAgentError(err, "timeout"));
    assert.equal(child.killed, true);
    assert.equal(child.lastSignal, "SIGKILL");
});

test("runPiCompletion kills the process and rejects on abort", async () => {
    const fake = makeFakeSpawn();
    const controller = new AbortController();
    const promise = runPiCompletion(baseRequest, baseConfig, controller.signal, fake.spawnFn);

    controller.abort();

    const child = fake.children[0];
    await assert.rejects(promise, (err: unknown) => isPiAgentError(err, "abort"));
    assert.equal(child.killed, true);
    assert.equal(child.lastSignal, "SIGTERM");
});

test("runPiCompletion rejects when the process cannot be spawned", async () => {
    const fake = makeFakeSpawn();
    const promise = runPiCompletion(baseRequest, baseConfig, undefined, fake.spawnFn);

    fake.children[0].emit("error", new Error("ENOENT"));

    await assert.rejects(promise, (err: unknown) => isPiAgentError(err, "spawn"));
});

test("runPiCompletion rejects an empty launch command without spawning", async () => {
    const fake = makeFakeSpawn();
    await assert.rejects(
        runPiCompletion(baseRequest, { ...baseConfig, command: [] }, undefined, fake.spawnFn),
        (err: unknown) => isPiAgentError(err, "spawn"),
    );
    assert.equal(fake.children.length, 0);
});
