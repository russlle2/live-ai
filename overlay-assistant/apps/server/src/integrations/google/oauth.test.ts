import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoogleOAuthManager } from "./oauth.js";
import { GOOGLE_READONLY_SCOPES } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Google OAuth manager", () => {
  it("uses readonly scopes and stores the renewable token owner-only", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-oauth-"));
    temporaryDirectories.push(storageDir);
    const now = new Date("2026-07-13T12:00:00.000Z");
    const requests: Array<{ url: string; body: string }> = [];
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({
        access_token: "access-one",
        refresh_token: "refresh-one",
        expires_in: 3600,
        token_type: "Bearer",
        scope: GOOGLE_READONLY_SCOPES.join(" ")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const manager = new GoogleOAuthManager({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:8080/api/google/oauth/callback",
      storageDir,
      storageEncryptionKey: "test-google-storage-encryption-key-32-plus",
      fetch: fetchMock,
      now: () => now
    });

    const authorization = await manager.beginAuthorization();
    const url = new URL(authorization.url);
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GOOGLE_READONLY_SCOPES]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    await manager.completeAuthorization({ code: "one-time-code", state: authorization.state });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toContain("grant_type=authorization_code");
    expect(await manager.getAccessToken()).toBe("access-one");
    expect((await manager.status()).authorized).toBe(true);

    const tokenPath = path.join(storageDir, "google-oauth-token.json");
    expect((await fs.stat(tokenPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(storageDir)).mode & 0o777).toBe(0o700);
    const rawToken = await fs.readFile(tokenPath, "utf8");
    expect(rawToken).toContain("private_encrypted_json_v1");
    expect(rawToken).not.toContain("access-one");
    expect(rawToken).not.toContain("refresh-one");
  });

  it("silently refreshes an expired access token without another authorization flow", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-refresh-"));
    temporaryDirectories.push(storageDir);
    let now = new Date("2026-07-13T12:00:00.000Z");
    let call = 0;
    const fetchMock = (async (_input: string | URL | Request, init?: RequestInit) => {
      call += 1;
      const refreshing = String(init?.body ?? "").includes("grant_type=refresh_token");
      return new Response(JSON.stringify({
        access_token: refreshing ? "access-two" : "access-one",
        refresh_token: refreshing ? undefined : "refresh-one",
        expires_in: refreshing ? 3600 : 1,
        token_type: "Bearer",
        scope: GOOGLE_READONLY_SCOPES.join(" ")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const manager = new GoogleOAuthManager({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost/callback",
      storageDir,
      storageEncryptionKey: "test-google-storage-encryption-key-32-plus",
      fetch: fetchMock,
      now: () => now
    });
    const authorization = await manager.beginAuthorization();
    await manager.completeAuthorization({ code: "code", state: authorization.state });
    now = new Date("2026-07-13T12:02:00.000Z");

    expect(await manager.getAccessToken()).toBe("access-two");
    expect(call).toBe(2);
  });

  it("revokes the provider grant and removes local authorization", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-revoke-"));
    temporaryDirectories.push(storageDir);
    const requests: string[] = [];
    const fetchMock = (async (input: string | URL | Request) => {
      requests.push(String(input));
      if (String(input).includes("/revoke")) return new Response("", { status: 200 });
      return new Response(JSON.stringify({
        access_token: "access-one",
        refresh_token: "refresh-one",
        expires_in: 3600,
        token_type: "Bearer",
        scope: GOOGLE_READONLY_SCOPES.join(" ")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const manager = new GoogleOAuthManager({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost/callback",
      storageDir,
      storageEncryptionKey: "test-google-storage-encryption-key-32-plus",
      fetch: fetchMock,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    });
    const authorization = await manager.beginAuthorization();
    await manager.completeAuthorization({ code: "code", state: authorization.state });

    await expect(manager.revokeAuthorization()).resolves.toEqual({
      providerRevoked: true,
      localAuthorizationCleared: true,
      warnings: []
    });
    await expect(manager.status()).resolves.toMatchObject({ configured: true, authorized: false });
    expect(requests.some((url) => url.includes("/revoke"))).toBe(true);
    await expect(fs.stat(path.join(storageDir, "google-oauth-token.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears local authorization when provider revocation has a network failure", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-revoke-network-"));
    temporaryDirectories.push(storageDir);
    const fetchMock = (async (input: string | URL | Request) => {
      if (String(input).includes("/revoke")) throw new Error("simulated network failure");
      return new Response(JSON.stringify({
        access_token: "access-one",
        refresh_token: "refresh-one",
        expires_in: 3600,
        token_type: "Bearer",
        scope: GOOGLE_READONLY_SCOPES.join(" ")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const manager = new GoogleOAuthManager({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost/callback",
      storageDir,
      storageEncryptionKey: "test-google-storage-encryption-key-32-plus",
      fetch: fetchMock,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    });
    const authorization = await manager.beginAuthorization();
    await manager.completeAuthorization({ code: "code", state: authorization.state });

    await expect(manager.revokeAuthorization()).resolves.toEqual({
      providerRevoked: false,
      localAuthorizationCleared: true,
      warnings: ["provider_revocation_network_failed"]
    });
    await expect(manager.status()).resolves.toMatchObject({ configured: true, authorized: false });
    await expect(fs.stat(path.join(storageDir, "google-oauth-token.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(storageDir, "google-oauth-pending.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
