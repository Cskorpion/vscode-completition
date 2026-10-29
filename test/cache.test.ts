/**
 * Unit tests for the LRU completion cache.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CompletionCache } from "../src/cache";

test("stores and returns values", () => {
    const cache = new CompletionCache(3);
    cache.set("a", "1");
    assert.equal(cache.get("a"), "1");
    assert.equal(cache.size, 1);
});

test("returns undefined for missing keys", () => {
    const cache = new CompletionCache(3);
    assert.equal(cache.get("missing"), undefined);
});

test("evicts the least recently used entry", () => {
    const cache = new CompletionCache(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a"); // refresh "a" so "b" becomes the LRU entry
    cache.set("c", "3"); // must evict "b"

    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), "1");
    assert.equal(cache.get("c"), "3");
    assert.equal(cache.size, 2);
});

test("updating an existing key does not evict", () => {
    const cache = new CompletionCache(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("a", "updated");

    assert.equal(cache.get("a"), "updated");
    assert.equal(cache.get("b"), "2");
    assert.equal(cache.size, 2);
});

test("clear removes everything", () => {
    const cache = new CompletionCache(3);
    cache.set("a", "1");
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get("a"), undefined);
});

test("capacity zero stores nothing", () => {
    const cache = new CompletionCache(0);
    cache.set("a", "1");
    assert.equal(cache.size, 0);
    assert.equal(cache.get("a"), undefined);
});
