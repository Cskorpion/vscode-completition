/**
 * Unit tests for the acceptance tracker that prevents suggestion loops.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AcceptedCompletionTracker } from "../src/acceptance";

test("suppresses an identical candidate that is already in the document", () => {
    const tracker = new AcceptedCompletionTracker();
    tracker.record("foo();");

    // Prefix ends with the accepted text: offering it again would duplicate it.
    assert.equal(tracker.shouldSuppress("bar\nfoo();", "foo();"), true);
});

test("keeps a different candidate after an acceptance", () => {
    const tracker = new AcceptedCompletionTracker();
    tracker.record("foo();");

    assert.equal(tracker.shouldSuppress("bar\nfoo();", "baz();"), false);
});

test("keeps an identical candidate when the prefix does not end with it", () => {
    const tracker = new AcceptedCompletionTracker();
    tracker.record("foo();");

    // The cursor moved on; repeating the text further down is legitimate.
    assert.equal(tracker.shouldSuppress("foo();\nbar", "foo();"), false);
});

test("never suppresses empty candidates", () => {
    const tracker = new AcceptedCompletionTracker();
    tracker.record("");
    assert.equal(tracker.shouldSuppress("prefix", ""), false);
});

test("a fresh tracker suppresses nothing", () => {
    const tracker = new AcceptedCompletionTracker();
    assert.equal(tracker.shouldSuppress("anything", "anything"), false);
});
