import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearManagedPersonalAuthArtifacts,
  isDirectLoopbackRequest,
  isLoopbackAddress,
  isSafeLoopbackDemoBinding,
  loadOrCreatePersonalAuth,
  rotateManagedPersonalAuth
} from "./auth_bootstrap.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("personal auth bootstrap", () => {
  it("creates and reuses strong owner-only secrets with private permissions", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    const first = loadOrCreatePersonalAuth({
      filePath,
      allowInsecureDemoAuth: false,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    });
    const second = loadOrCreatePersonalAuth({ filePath, allowInsecureDemoAuth: false });
    expect(first).toEqual(second);
    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(first.personalAccessCode.length).toBeGreaterThanOrEqual(12);
    expect(first.storageEncryptionKey.length).toBeGreaterThanOrEqual(32);
    expect(first.storageEncryptionKey).not.toBe(first.jwtSecret);
    expect(first.managed).toBe(true);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  });

  it("never creates a bootstrap file in explicit demo mode", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-demo-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    expect(loadOrCreatePersonalAuth({ filePath, allowInsecureDemoAuth: true })).toEqual({
      jwtSecret: "",
      personalAccessCode: "",
      storageEncryptionKey: "",
      managed: false
    });
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never reuses an environment-managed JWT as the private storage key", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-explicit-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    const result = loadOrCreatePersonalAuth({
      filePath,
      jwtSecret: "j".repeat(48),
      personalAccessCode: "owner-code-123456",
      allowInsecureDemoAuth: false
    });
    expect(result).toEqual({
      jwtSecret: "j".repeat(48),
      personalAccessCode: "owner-code-123456",
      storageEncryptionKey: "",
      managed: false
    });
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects partial environment auth so purged credentials cannot return after restart", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-partial-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    expect(() => loadOrCreatePersonalAuth({
      filePath,
      jwtSecret: "j".repeat(48),
      allowInsecureDemoAuth: false
    })).toThrow(/both be set or both be omitted/);
    expect(() => loadOrCreatePersonalAuth({
      filePath,
      personalAccessCode: "owner-code-123456",
      allowInsecureDemoAuth: false
    })).toThrow(/both be set or both be omitted/);
  });

  it("rotates device credentials while preserving the private storage key", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-rotate-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    const before = loadOrCreatePersonalAuth({ filePath, allowInsecureDemoAuth: false });
    const after = rotateManagedPersonalAuth(filePath);
    expect(after.jwtSecret).not.toBe(before.jwtSecret);
    expect(after.personalAccessCode).not.toBe(before.personalAccessCode);
    expect(after.storageEncryptionKey).toBe(before.storageEncryptionKey);
  });

  it("rotates the private storage key for a full owner-data erasure", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-erase-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    const before = loadOrCreatePersonalAuth({ filePath, allowInsecureDemoAuth: false });
    const after = rotateManagedPersonalAuth(filePath, { rotateStorageEncryptionKey: true });
    expect(after.jwtSecret).not.toBe(before.jwtSecret);
    expect(after.personalAccessCode).not.toBe(before.personalAccessCode);
    expect(after.storageEncryptionKey).not.toBe(before.storageEncryptionKey);
  });

  it("removes crash-left auth siblings without touching unrelated files", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-auth-temp-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "personal-auth.json");
    loadOrCreatePersonalAuth({ filePath, allowInsecureDemoAuth: false });
    const crashTemp = `${filePath}.old.123.tmp`;
    const unrelated = path.join(directory, "unrelated.tmp");
    await fs.writeFile(crashTemp, "old credentials", { mode: 0o600 });
    await fs.writeFile(unrelated, "keep", { mode: 0o600 });

    expect(clearManagedPersonalAuthArtifacts(filePath)).toEqual({
      removedState: false,
      removedTempFiles: 1
    });
    await expect(fs.stat(crashTemp)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(unrelated, "utf8")).resolves.toBe("keep");
  });

  it("recognizes only direct loopback clients", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isDirectLoopbackRequest({ remoteAddress: "127.0.0.1" })).toBe(true);
    expect(isDirectLoopbackRequest({
      remoteAddress: "127.0.0.1",
      xForwardedFor: "192.168.1.20"
    })).toBe(false);
    expect(isDirectLoopbackRequest({ remoteAddress: "172.18.0.1" })).toBe(false);
    expect(isSafeLoopbackDemoBinding({
      host: "127.0.0.1",
      webOrigin: "http://localhost:5173"
    })).toBe(true);
    expect(isSafeLoopbackDemoBinding({
      host: "0.0.0.0",
      webOrigin: "http://localhost:5173"
    })).toBe(false);
    expect(isSafeLoopbackDemoBinding({
      host: "127.0.0.1",
      webOrigin: "https://assistant.example.test"
    })).toBe(false);
  });
});
