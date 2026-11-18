import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_SECRET_SESSION_KEY,
  clearPresenterRunSecret,
  readPresenterRunSecret,
  writePresenterRunSecret,
} from "../src/lib/presenter-secret";

describe("presenter run secret (sessionStorage)", () => {
  const store = new Map<string, string>();

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("reads, writes, and clears the session key without exposing via page source", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });

    expect(readPresenterRunSecret()).toBe("");
    writePresenterRunSecret("  demo-secret  ");
    expect(store.get(RUN_SECRET_SESSION_KEY)).toBe("demo-secret");
    expect(readPresenterRunSecret()).toBe("demo-secret");
    clearPresenterRunSecret();
    expect(store.has(RUN_SECRET_SESSION_KEY)).toBe(false);
    expect(readPresenterRunSecret()).toBe("");
  });
});
