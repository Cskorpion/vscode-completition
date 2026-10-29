/**
 * A tiny LRU cache for completions, keyed by code context.
 *
 * The provider fires on every keystroke; identical contexts (typing, then
 * undoing, or VS Code re-querying the same position) should not hit the LLM
 * twice. Entries are ordered by recency: `get` refreshes, `set` evicts the
 * least recently used entry when the capacity is exceeded.
 */
export class CompletionCache {
    private readonly entries = new Map<string, string>();

    /** @param maxEntries Maximum number of cached context -> completion pairs. */
    constructor(readonly maxEntries: number) {}

    /**
     * Returns the cached completion for `key`, refreshing its recency,
     * or undefined when the key is unknown.
     */
    get(key: string): string | undefined {
        const value = this.entries.get(key);
        if (value === undefined) {
            return undefined;
        }
        // Refresh recency: delete + re-insert moves the key to the end.
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    /** Stores a completion, evicting the least recently used entry if needed. */
    set(key: string, value: string): void {
        if (this.maxEntries <= 0) {
            return;
        }
        if (this.entries.has(key)) {
            this.entries.delete(key);
        } else if (this.entries.size >= this.maxEntries) {
            // Map iterates in insertion order, so the first key is the LRU one.
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) {
                this.entries.delete(oldest);
            }
        }
        this.entries.set(key, value);
    }

    /** Number of cached entries. */
    get size(): number {
        return this.entries.size;
    }

    /** Drops every cached entry. */
    clear(): void {
        this.entries.clear();
    }
}
