import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

import { getVercelOidcToken } from "@vercel/oidc";
import { resolveAuthStatus, resolveOidcToken } from "../src/lib/auth";

const mockedGetToken = vi.mocked(getVercelOidcToken);

afterEach(() => {
  vi.resetAllMocks();
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_TEAM_ID;
  delete process.env.VERCEL_PROJECT_ID;
});

describe("resolveOidcToken", () => {
  it("returns the token from getVercelOidcToken (header/context path)", async () => {
    mockedGetToken.mockResolvedValue("hdr-oidc-token");
    await expect(resolveOidcToken()).resolves.toBe("hdr-oidc-token");
  });

  it("falls back to VERCEL_OIDC_TOKEN when getVercelOidcToken throws", async () => {
    mockedGetToken.mockRejectedValue(new Error("missing header"));
    process.env.VERCEL_OIDC_TOKEN = "env-oidc-token";
    await expect(resolveOidcToken()).resolves.toBe("env-oidc-token");
  });

  it("returns null when neither header nor env is available", async () => {
    mockedGetToken.mockRejectedValue(new Error("missing header"));
    await expect(resolveOidcToken()).resolves.toBeNull();
  });
});

describe("resolveAuthStatus", () => {
  it("does not hard-fail when only OIDC header token is present", async () => {
    mockedGetToken.mockResolvedValue("hdr-oidc-token");
    const status = await resolveAuthStatus();
    expect(status.hasAiGatewayAuth).toBe(true);
    expect(status.hasSandboxAuth).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("accepts AI_GATEWAY_API_KEY + token trio without OIDC", async () => {
    mockedGetToken.mockRejectedValue(new Error("missing header"));
    process.env.AI_GATEWAY_API_KEY = "gw_key";
    process.env.VERCEL_TOKEN = "tok";
    process.env.VERCEL_TEAM_ID = "team";
    process.env.VERCEL_PROJECT_ID = "proj";
    const status = await resolveAuthStatus();
    expect(status.hasAiGatewayAuth).toBe(true);
    expect(status.hasSandboxAuth).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("reports missing when nothing is configured", async () => {
    mockedGetToken.mockRejectedValue(new Error("missing header"));
    const status = await resolveAuthStatus();
    expect(status.hasAiGatewayAuth).toBe(false);
    expect(status.hasSandboxAuth).toBe(false);
    expect(status.missing.length).toBeGreaterThanOrEqual(2);
  });
});
