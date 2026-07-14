import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { PrivateJsonStore, PrivateStoreEncryptionError } from "./private_store.js";

const temporaryDirectories: string[] = [];
const TestSchema = z.object({ token: z.string(), text: z.string() });
const encryptionKey = "test-private-storage-encryption-key-long-enough";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("private JSON store encryption", () => {
  it("encrypts values at rest and decrypts them only with the configured key", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-private-store-"));
    temporaryDirectories.push(storageDir);
    const filePath = path.join(storageDir, "secrets.json");
    const store = new PrivateJsonStore(filePath, TestSchema, () => ({ token: "", text: "" }), encryptionKey);
    await store.write({ token: "refresh-token-value", text: "private source body" });

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).toContain("private_encrypted_json_v1");
    expect(raw).not.toContain("refresh-token-value");
    expect(raw).not.toContain("private source body");
    expect(await store.read()).toEqual({ token: "refresh-token-value", text: "private source body" });

    const wrongKey = new PrivateJsonStore(
      filePath,
      TestSchema,
      () => ({ token: "", text: "" }),
      "different-private-storage-key-that-is-long-enough"
    );
    await expect(wrongKey.read()).rejects.toBeInstanceOf(PrivateStoreEncryptionError);
  });

  it("atomically migrates a valid legacy plaintext file on first read", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-private-migrate-"));
    temporaryDirectories.push(storageDir);
    const filePath = path.join(storageDir, "legacy.json");
    await fs.writeFile(filePath, JSON.stringify({ token: "legacy-token", text: "legacy body" }), { mode: 0o600 });
    const store = new PrivateJsonStore(filePath, TestSchema, () => ({ token: "", text: "" }), encryptionKey);

    expect(await store.read()).toEqual({ token: "legacy-token", text: "legacy body" });
    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).toContain("private_encrypted_json_v1");
    expect(raw).not.toContain("legacy-token");
    expect(raw).not.toContain("legacy body");
  });

  it("uses a rotated key for every value written after owner deletion", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-private-rotate-"));
    temporaryDirectories.push(storageDir);
    const filePath = path.join(storageDir, "secrets.json");
    const nextKey = "rotated-private-storage-encryption-key-long-enough";
    const store = new PrivateJsonStore(filePath, TestSchema, () => ({ token: "", text: "" }), encryptionKey);
    await store.write({ token: "old", text: "old private data" });
    await store.clear();
    store.rotateEncryptionKey(nextKey);
    await store.write({ token: "new", text: "new private data" });

    await expect(new PrivateJsonStore(
      filePath,
      TestSchema,
      () => ({ token: "", text: "" }),
      encryptionKey
    ).read()).rejects.toBeInstanceOf(PrivateStoreEncryptionError);
    await expect(store.read()).resolves.toEqual({ token: "new", text: "new private data" });
  });

  it("clears only crash-left temporary siblings for the same private file", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-private-clear-"));
    temporaryDirectories.push(storageDir);
    const filePath = path.join(storageDir, "secrets.json");
    const store = new PrivateJsonStore(filePath, TestSchema, () => ({ token: "", text: "" }), encryptionKey);
    await store.write({ token: "old", text: "old private data" });
    const matchingTemp = `${filePath}.123.456.tmp`;
    const unrelatedTemp = path.join(storageDir, "other.json.123.456.tmp");
    await fs.writeFile(matchingTemp, "old private data", { mode: 0o600 });
    await fs.writeFile(unrelatedTemp, "keep", { mode: 0o600 });

    await store.clear();

    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(matchingTemp)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(unrelatedTemp, "utf8")).resolves.toBe("keep");
  });
});
