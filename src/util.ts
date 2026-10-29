/**
 * Small async helpers shared by the completion provider.
 */

/**
 * Resolves after `ms` milliseconds, or rejects with an AbortError as soon as
 * `signal` fires. Used to debounce completion requests; aborting also kills
 * the pi subprocess started for the same request (see the provider).
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };

        if (signal?.aborted) {
            onAbort();
        } else {
            signal?.addEventListener("abort", onAbort, { once: true });
        }
    });
}

/** Creates an Error carrying the conventional name "AbortError". */
export function abortError(): Error {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
}

/** True for AbortError-named errors (e.g. from sleep() or fetch()). */
export function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === "AbortError";
}
