import { describe, it, expect, vi, afterEach } from "vitest";
import { awaitSuspense, MIN_SUSPENSE_MS, SLOW_AFTER_MS } from "./useSuspense";

/**
 * the layout call timing rule: the result shows when BOTH the server response AND
 * a 1.2s minimum timer finish (Promise.all).
 *
 * These are the cases that distinguish Promise.all from the more obvious
 * implementations. A "wait for whichever finishes first" version passes a naive
 * test and fails every one of these.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("awaitSuspense", () => {
  it("holds a fast server response until the 1.2s floor is reached", async () => {
    vi.useFakeTimers();
    // Server answers in 180ms - well inside the floor.
    const server = new Promise<string>((r) => setTimeout(() => r("landed"), 180));

    let done = false;
    const p = awaitSuspense(server).then((v) => {
      done = true;
      return v;
    });

    // The server is long since done at 1.2s, but the floor holds the result.
    await vi.advanceTimersByTimeAsync(MIN_SUSPENSE_MS - 1);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toBe("landed");
    expect(done).toBe(true);
  });

  it("does not add time when the server is slower than the floor", async () => {
    vi.useFakeTimers();
    // 4s server: the floor is already satisfied, so the result is the server's.
    const server = new Promise<string>((r) => setTimeout(() => r("slow"), 4_000));

    let done = false;
    const p = awaitSuspense(server).then((v) => {
      done = true;
      return v;
    });

    await vi.advanceTimersByTimeAsync(1_200);
    expect(done).toBe(false); // floor alone is not enough

    await vi.advanceTimersByTimeAsync(2_800);
    await expect(p).resolves.toBe("slow");
    expect(done).toBe(true);
  });

  it("resolves at the later of the two, never the earlier", async () => {
    vi.useFakeTimers();
    const timings: number[] = [];
    const started = Date.now();

    const server = new Promise<string>((r) => setTimeout(() => r("x"), 2_000));
    const p = awaitSuspense(server).then(() => timings.push(Date.now() - started));

    await vi.advanceTimersByTimeAsync(2_500);
    await p;
    // Server at 2000ms beat the 1200ms floor, so the result lands at 2000ms.
    expect(timings).toEqual([2_000]);
  });

  it("uses the reviewer's 1.2s floor by default", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    let at = 0;
    const p = awaitSuspense(Promise.resolve("now")).then(() => {
      at = Date.now() - started;
    });
    await vi.advanceTimersByTimeAsync(MIN_SUSPENSE_MS + 10);
    await p;
    expect(at).toBe(MIN_SUSPENSE_MS);
  });

  // An error is not worth pacing. Holding a refusal for another second would
  // make a rejected signature feel broken rather than answered.
  it("rejects as soon as the server rejects, without waiting for the floor", async () => {
    vi.useFakeTimers();
    const server = new Promise<string>((_, rej) => setTimeout(() => rej(new Error("nope")), 100));

    let rejected = false;
    const p = awaitSuspense(server).catch(() => {
      rejected = true;
    });

    await vi.advanceTimersByTimeAsync(150);
    await p;
    expect(rejected).toBe(true);
  });

  it("honours a custom floor, which the reduced-motion path relies on keeping", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    let at = 0;
    const p = awaitSuspense(Promise.resolve("x"), { minMs: 400 }).then(() => {
      at = Date.now() - started;
    });
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(at).toBe(400);
  });

  // `elapsed()` is always ~0 when awaitSuspense is called, so the "floor already
  // satisfied" branch is only reachable with a zero floor. Covered explicitly so
  // the guard is known to work rather than merely present.
  it("resolves without scheduling a timer when the floor is already satisfied", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    await expect(awaitSuspense(Promise.resolve("late"), { minMs: 0 })).resolves.toBe("late");
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it("exports the reviewer's 10s slow threshold", () => {
    expect(SLOW_AFTER_MS).toBe(10_000);
  });
});