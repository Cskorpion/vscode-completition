/**
 * Unit tests for prompt and context construction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildCodeContext,
    buildPiRequest,
    COMPLETION_SYSTEM_PROMPT,
    CURSOR_MARKER,
} from "../src/pi/promptBuilder";

test("buildCodeContext slices a bounded prefix and suffix", () => {
    const before = "a".repeat(50);
    const after = "b".repeat(50);
    const context = buildCodeContext(before, after, 10, 20);

    assert.equal(context.prefix, "a".repeat(10));
    assert.equal(context.suffix, "b".repeat(20));
});

test("buildCodeContext keeps short contexts intact", () => {
    const context = buildCodeContext("abc", "def", 100, 100);

    assert.equal(context.prefix, "abc");
    assert.equal(context.suffix, "def");
});

test("cache key is stable and separator-based", () => {
    const a = buildCodeContext("x", "y", 10, 10);
    const b = buildCodeContext("x", "y", 10, 10);
    assert.equal(a.cacheKey, b.cacheKey);
    assert.ok(a.cacheKey.includes("\u0000"));

    // Different prefix/suffix splits must never collide.
    assert.notEqual(
        buildCodeContext("x", "y", 10, 10).cacheKey,
        buildCodeContext("xy", "", 10, 10).cacheKey,
    );
});

test("buildPiRequest places the cursor marker between prefix and suffix", () => {
    const context = buildCodeContext("before", "after", 100, 100);
    const request = buildPiRequest(context);

    assert.ok(request.stdin.includes("before" + CURSOR_MARKER));
    assert.ok(request.stdin.includes("after"));
    assert.ok(request.instruction.includes(CURSOR_MARKER));
});

test("system prompt demands bare code output", () => {
    assert.match(COMPLETION_SYSTEM_PROMPT, /only/i);
    assert.match(COMPLETION_SYSTEM_PROMPT, /fence/i);
    assert.match(COMPLETION_SYSTEM_PROMPT, /<CURSOR>/);
});
