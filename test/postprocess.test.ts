/**
 * Unit tests for the defensive model-output cleanup.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCompletion } from "../src/pi/postprocess";

test("plain code passes through unchanged", () => {
    assert.equal(extractCompletion("x y)"), "x y)");
});

test("surrounding whitespace is trimmed", () => {
    assert.equal(extractCompletion("  \n\n x y) \n\n  "), "x y)");
});

test("fully fenced block with language tag is unwrapped", () => {
    assert.equal(extractCompletion("```racket\n(define x 1)\n```"), "(define x 1)");
});

test("fully fenced block without language tag is unwrapped", () => {
    assert.equal(extractCompletion("```\ncode\n```"), "code");
});

test("stray trailing fence is dropped", () => {
    // Small models sometimes emit code and then an unmatched closing fence.
    assert.equal(extractCompletion("code\n```"), "code");
});

test("stray leading fence is dropped", () => {
    // Or an opening fence without a closing one (ran out of tokens).
    assert.equal(extractCompletion("```racket\ncode"), "code");
});

test("inner fence markers inside the code are preserved", () => {
    assert.equal(extractCompletion('```js\nconst s = "```";\n```'), 'const s = "```";');
});

test("empty input yields an empty string", () => {
    assert.equal(extractCompletion(""), "");
    assert.equal(extractCompletion("   \n\n  "), "");
});
