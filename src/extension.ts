/**
 * Extension entry point. Wires the inline completion provider and the
 * acceptance command into VS Code.
 *
 * Architecture overview:
 *
 *   VS Code (keystroke)
 *     -> PiInlineCompletionProvider (debounce, cache, accept tracking)
 *       -> runPiCompletion() spawns the pi CLI in print mode
 *         -> pi resolves providers/models/auth from ~/.pi/agent
 *           -> LLM
 *
 * The extension never talks to an LLM API itself; pi owns that concern.
 */
import * as vscode from "vscode";
import { readSettings } from "./configuration";
import { Logger } from "./log";
import { PI_COMPLETION_ACCEPTED_COMMAND, PiInlineCompletionProvider } from "./provider";

export function activate(context: vscode.ExtensionContext): void {
    const logger = new Logger(() => readSettings().debug);
    const provider = new PiInlineCompletionProvider(logger);

    context.subscriptions.push(
        // Executed by VS Code right after an inline completion was inserted.
        vscode.commands.registerCommand(PI_COMPLETION_ACCEPTED_COMMAND, (text: string) => {
            provider.onCompletionAccepted(text);
        }),
        // Offer completions in every text file.
        vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider),
        logger,
    );
}

export function deactivate(): void {
    // Nothing to do: the provider owns no long-lived resources of its own;
    // in-flight pi subprocesses are killed when their requests are aborted.
}
