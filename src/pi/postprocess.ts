/**
 * Defensive cleanup of model output.
 *
 * With the completion system prompt the model should return bare code, but
 * small local models sometimes wrap it in markdown code fences anyway.
 * Instead of silently showing fence markers as ghost text, we strip the
 * common shapes here.
 */

/**
 * Extracts the completion from pi's raw stdout:
 *
 *   - trims surrounding whitespace,
 *   - unwraps fully fenced blocks ("```lang ... ```"),
 *   - drops a stray trailing or leading fence line.
 *
 * Returns "" when the model produced nothing usable.
 */
export function extractCompletion(raw: string): string {
    let lines = raw.trim().split("\n");

    const startsWithFence = lines.length > 0 && lines[0].startsWith("```");
    const endsWithFence = lines.length >= 2 && lines[lines.length - 1].trim() === "```";

    if (startsWithFence && endsWithFence) {
        // Fully fenced block, e.g. "```racket\n...\n```": keep the inner code.
        lines = lines.slice(1, -1);
    } else if (endsWithFence) {
        // Model emitted code, then a stray closing fence: drop the fence line.
        lines = lines.slice(0, -1);
    } else if (startsWithFence) {
        // Opening fence without a closing one (ran out of tokens): drop it.
        lines = lines.slice(1);
    }

    return lines.join("\n").trim();
}
