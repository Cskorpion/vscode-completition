/**
 * The inline completion provider: the piece VS Code talks to.
 *
 * Responsibilities per provideInlineCompletionItems call:
 *
 *   1. Debounce: wait `debounceMs`; if another call arrives in the meantime,
 *      this one is aborted (its pi subprocess is killed) and returns nothing.
 *   2. Build the bounded code context around the cursor.
 *   3. Serve from the LRU cache when the context is known.
 *   4. Otherwise ask pi (subprocess) and post-process the raw answer.
 *   5. Suppress candidates that would just repeat the last accepted
 *      completion (prevents ghost-text loops after Tab).
 *
 * Concurrency model: a monotonically increasing sequence number plus one
 * AbortController per call. Newer calls abort older ones; a request that was
 * superseded during the pi round-trip drops its result.
 */
import * as vscode from "vscode";
import { AcceptedCompletionTracker } from "./acceptance";
import { CompletionCache } from "./cache";
import { readSettings } from "./configuration";
import { Logger } from "./log";
import { runPiCompletion, isPiAgentError } from "./pi/piAgent";
import { buildCodeContext, buildPiRequest, COMPLETION_SYSTEM_PROMPT } from "./pi/promptBuilder";
import { extractCompletion } from "./pi/postprocess";
import { isAbortError, sleep } from "./util";

/**
 * Command executed by VS Code right after a completion was accepted.
 * Registered in extension.ts; declared internal on purpose (not in
 * package.json contributes.commands) so it never shows in the palette.
 */
export const PI_COMPLETION_ACCEPTED_COMMAND = "vscodeTabComplete.completionAccepted";

/** Maximum number of cached context -> completion pairs. */
const CACHE_CAPACITY = 100;

export class PiInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private readonly cache = new CompletionCache(CACHE_CAPACITY);
    private readonly accepted = new AcceptedCompletionTracker();
    /** Increased on every call; only the latest request may produce a result. */
    private sequence = 0;
    /** Controller of the currently running pi request, if any. */
    private inFlight?: AbortController;
    /** Whether the user was already warned about a broken launch command. */
    private warnedSpawnFailure = false;

    constructor(private readonly logger: Logger) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[]> {
        const settings = readSettings();
        const requestId = ++this.sequence;

        // Funnel both "a newer request arrived" and "VS Code cancelled" into
        // one AbortController that also kills the pi subprocess.
        this.inFlight?.abort();
        const controller = new AbortController();
        this.inFlight = controller;
        const cancellation = token.onCancellationRequested(() => controller.abort());

        try {
            // 1) Debounce. An abort (superseded or cancelled) leaves early.
            try {
                await sleep(settings.debounceMs, controller.signal);
            } catch (err) {
                if (isAbortError(err)) {
                    return [];
                }
                throw err;
            }
            if (requestId !== this.sequence || token.isCancellationRequested) {
                return []; // superseded by a newer request
            }

            // 2) Bounded context around the cursor.
            const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
            const documentEnd = document.lineAt(document.lineCount - 1).range.end;
            const after = document.getText(new vscode.Range(position, documentEnd));

            // Degenerate case: an empty document gives the model nothing to
            // work with, and any answer would be pure hallucination.
            if (before === "" && after === "") {
                return [];
            }

            const context = buildCodeContext(
                before,
                after,
                settings.contextPrefixChars,
                settings.contextSuffixChars,
            );

            // 3) Cache hit?
            const cached = this.cache.get(context.cacheKey);
            if (cached !== undefined) {
                if (this.accepted.shouldSuppress(context.prefix, cached)) {
                    return [];
                }
                this.logger.log("completion served from cache");
                return [this.toItem(cached)];
            }

            // 4) Ask pi.
            this.logger.log("asking pi for a completion...");
            const raw = await runPiCompletion(
                buildPiRequest(context),
                {
                    command: settings.command,
                    model: settings.model,
                    timeoutMs: settings.timeoutMs,
                    systemPrompt: COMPLETION_SYSTEM_PROMPT,
                },
                controller.signal,
            );
            if (requestId !== this.sequence) {
                return []; // stale; a newer request owns the answer
            }

            const completion = extractCompletion(raw);
            if (completion === "" || this.accepted.shouldSuppress(context.prefix, completion)) {
                return [];
            }

            this.cache.set(context.cacheKey, completion);
            this.logger.log(`pi returned a ${completion.length} char completion`);
            return [this.toItem(completion)];
        } catch (err) {
            // Aborts are the normal way requests end here (superseded or
            // cancelled); everything else is worth surfacing.
            if (isAbortError(err) || isPiAgentError(err, "abort")) {
                return [];
            }
            this.logger.log("completion request failed", err instanceof Error ? err.message : String(err));
            if (isPiAgentError(err, "spawn") && !this.warnedSpawnFailure) {
                this.warnedSpawnFailure = true;
                void vscode.window.showWarningMessage(
                    "vscode-tab-complete: could not launch the pi agent. " +
                        "Check the `vscodeTabComplete.command` setting.",
                );
            }
            return [];
        } finally {
            cancellation.dispose();
            if (this.inFlight === controller) {
                this.inFlight = undefined;
            }
        }
    }

    /**
     * Called via PI_COMPLETION_ACCEPTED_COMMAND after VS Code inserted a
     * completion. Feeds the acceptance tracker so the next request at the
     * new cursor does not re-suggest the same text.
     */
    onCompletionAccepted(text: string): void {
        this.accepted.record(text);
        this.logger.log("completion accepted by the user");
    }

    /**
     * Wraps completion text in an InlineCompletionItem without a replacement
     * range (pure ghost-text insertion at the cursor) and attaches the
     * acceptance command so the provider learns about Tab presses.
     */
    private toItem(completion: string): vscode.InlineCompletionItem {
        return new vscode.InlineCompletionItem(
            completion,
            undefined,
            {
                title: "Pi completion accepted",
                command: PI_COMPLETION_ACCEPTED_COMMAND,
                arguments: [completion],
            },
        );
    }
}
