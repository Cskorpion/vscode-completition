/**
 * Unit tests for the async helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { abortError, isAbortError, sleep } from "../src/util";

test("sleep resolves after the delay", async () => {
    const start = Date.now();
    await sleep(20);
    assert.ok(Date.now() - start >= 15);
});

test("sleep rejects with an AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort();
    await assert.rejects(promise, (err: unknown) => isAbortError(err));
});

test("sleep rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sleep(10_000, controller.signal), (err: unknown) => isAbortError(err));
});

test("abortError carries the conventional AbortError name", () => {
    const err = abortError();
    assert.equal(err.name, "AbortError");
    assert.ok(isAbortError(err));
    assert.ok(!isAbortError(new Error("regular")));
});
