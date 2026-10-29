/**
 * Acceptance tracking for inline completions.
 *
 * After VS Code inserts an accepted completion it immediately re-queries
 * the provider at the new cursor. Without tracking, the model often repeats
 * the text that was just accepted, leading to a ghost-text suggestion loop.
 * We therefore remember the last accepted completion and suppress an
 * identical candidate when the text right before the cursor already ends
 * with it, i.e. when accepting it again would just duplicate code.
 *
 * Different candidates are never suppressed: a follow-up suggestion for the
 * *next* piece of code is exactly what we want after an acceptance.
 */
export class AcceptedCompletionTracker {
    /** The most recently accepted completion text, if any. */
    private lastAccepted: string | undefined;

    /** Called when VS Code inserted a completion (Tab). */
    record(text: string): void {
        this.lastAccepted = text;
    }

    /**
     * True when `candidate` should NOT be offered: it is byte-identical to
     * the last accepted completion and the text right before the cursor
     * already ends with it.
     *
     * @param prefixBeforeCursor Code context directly before the cursor.
     * @param candidate Completion the provider is about to offer.
     */
    shouldSuppress(prefixBeforeCursor: string, candidate: string): boolean {
        if (this.lastAccepted === undefined || candidate.length === 0) {
            return false;
        }
        return candidate === this.lastAccepted && prefixBeforeCursor.endsWith(candidate);
    }
}
