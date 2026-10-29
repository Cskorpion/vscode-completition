/**
 * Prompt construction for the pi-backed completion provider.
 *
 * The inline completion provider only knows two things: the text before the
 * cursor and the text after it. This module turns them into
 *
 *   1. a bounded code context (prefix/suffix slices) plus a cache key,
 *   2. the actual request sent to pi (stdin payload + short instruction),
 *   3. the system prompt that turns pi into a completion engine.
 */

import type { PiCompletionRequest } from "./piAgent";

/** Marker for the cursor position inside the prompt. */
export const CURSOR_MARKER = "<CURSOR>";

/**
 * System prompt for pi. Replaces pi's default coding-assistant prompt so the
 * model answers in bare completion format instead of chat format: no
 * explanations, no markdown, no code fences - just the missing code.
 */
export const COMPLETION_SYSTEM_PROMPT = [
    "You are a code completion engine embedded in a text editor.",
    "You receive code with a <CURSOR> marker and return ONLY the code that should be inserted at that marker.",
    "Never output explanations, markdown, or code fences.",
    "Match the surrounding language, style and indentation.",
    "Keep completions short: a few lines at most, unless more is clearly needed.",
].join(" ");

/** Bounded code context around the cursor. */
export interface CodeContext {
    /** Characters directly before the cursor (at most `prefixChars`). */
    prefix: string;
    /** Characters directly after the cursor (at most `suffixChars`). */
    suffix: string;
    /** Stable key for the completion cache. */
    cacheKey: string;
}

/**
 * Separator for cache keys. NUL cannot appear in editor text, so the split
 * between prefix and suffix is unambiguous.
 */
const CACHE_KEY_SEPARATOR = "\u0000";

/**
 * Slices the document text around the cursor into a bounded context.
 * `before`/`after` are the full document halves; only the last `prefixChars`
 * and the first `suffixChars` of them are kept.
 */
export function buildCodeContext(
    before: string,
    after: string,
    prefixChars: number,
    suffixChars: number,
): CodeContext {
    const prefix = before.slice(-prefixChars);
    const suffix = after.slice(0, suffixChars);
    return { prefix, suffix, cacheKey: prefix + CACHE_KEY_SEPARATOR + suffix };
}

/**
 * Builds the pi request for a code context. The context template goes through
 * stdin (arbitrary size, no command-line length limit); the terse instruction
 * is passed as the message argument.
 */
export function buildPiRequest(context: CodeContext): PiCompletionRequest {
    return {
        stdin: [
            `Complete the code at the position marked with ${CURSOR_MARKER}.`,
            "",
            "Code before the cursor:",
            context.prefix + CURSOR_MARKER,
            "",
            "Code after the cursor:",
            context.suffix,
        ].join("\n"),
        instruction:
            `Return ONLY the code that is missing at ${CURSOR_MARKER}. ` +
            "No explanations, no markdown, no code fences.",
    };
}
