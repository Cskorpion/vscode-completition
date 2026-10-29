/**
 * Lazy output-channel logger.
 *
 * The output channel is created on first use and only when debug logging is
 * enabled, so normal operation costs nothing. `isEnabled` is evaluated per
 * call, which lets the debug setting apply live without a reload.
 */
import * as vscode from "vscode";

export class Logger implements vscode.Disposable {
    private channel: vscode.OutputChannel | undefined;

    /** @param isEnabled Evaluated per log call; enables logging when true. */
    constructor(private readonly isEnabled: () => boolean) {}

    /** Appends a timestamped line to the "vscode-tab-complete" output channel. */
    log(message: string, ...details: unknown[]): void {
        if (!this.isEnabled()) {
            return;
        }
        this.channel ??= vscode.window.createOutputChannel("vscode-tab-complete");
        const suffix =
            details.length > 0
                ? " " + details.map((d) => (d instanceof Error ? d.message : String(d))).join(" ")
                : "";
        this.channel.appendLine(`[${new Date().toISOString()}] ${message}${suffix}`);
    }

    dispose(): void {
        this.channel?.dispose();
        this.channel = undefined;
    }
}
