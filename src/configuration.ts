/**
 * Reads the user settings for this extension.
 *
 * Settings are re-read on every completion request, so changes apply
 * immediately without a window reload. Values are defensively clamped so a
 * broken setting can never wedge the provider.
 */
import * as vscode from "vscode";

/** The contributes.configuration section in package.json. */
export const CONFIGURATION_SECTION = "vscodeTabComplete";

/** Fully validated view of the user settings. */
export interface TabCompleteSettings {
    /** Command that launches pi (e.g. ["pi"] or ["wsl.exe", "-e", "pi"]). */
    command: string[];
    /** Optional --model argument for pi; undefined uses pi's default. */
    model?: string;
    /** Debounce delay in milliseconds before pi is asked. */
    debounceMs: number;
    /** Hard kill limit for the pi subprocess in milliseconds. */
    timeoutMs: number;
    /** Context characters before the cursor sent to pi. */
    contextPrefixChars: number;
    /** Context characters after the cursor sent to pi. */
    contextSuffixChars: number;
    /** Enables the "vscode-tab-complete" output channel logging. */
    debug: boolean;
}

/** Reads and sanitizes the settings from the workspace configuration. */
export function readSettings(): TabCompleteSettings {
    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

    // Defensive: fall back to plain "pi" when the command setting is empty.
    const command = (config.get<string[]>("command") ?? []).filter((part) => part.length > 0);

    return {
        command: command.length > 0 ? command : ["pi"],
        model: config.get<string>("model") || undefined,
        debounceMs: clamp(config.get<number>("debounceMs", 600), 0, 10_000),
        timeoutMs: clamp(config.get<number>("timeoutMs", 15_000), 1_000, 600_000),
        contextPrefixChars: Math.max(0, config.get<number>("contextPrefixChars", 2000)),
        contextSuffixChars: Math.max(0, config.get<number>("contextSuffixChars", 1000)),
        debug: config.get<boolean>("debug", false),
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
