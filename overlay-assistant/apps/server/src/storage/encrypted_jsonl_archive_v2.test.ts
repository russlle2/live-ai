import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EncryptedJsonlArchiveV2,
  PrivateArchiveEncryptionError
} from "./encrypted_jsonl_archive_v2.js";

type RecordV2 = { id: number; text: string };

const temporaryDirectories: string[] = [];
const key = "test-private-archive-encryption-key-long-enough";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

async function archive(encryptionKey = key) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-archive-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "session.jsonl");
  return {
    directory,
    filePath,
    store: new EncryptedJsonlArchiveV2<RecordV2>({
      filePath,
      encryptionKey,
      validate: (value) => {
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as RecordV2).id !== "number" ||
          typeof (value as RecordV2).text !== "string"
        ) {
          throw new TypeError("invalid test record");
        }
        return value as RecordV2;
      }
    })
  };
}

describe("EncryptedJsonlArchiveV2", () => {
  it("round-trips records without exposing plaintext at rest", async () => {
    const { filePath, store } = await archive();
    await store.append({ id: 1, text: "private transcript wording" });

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).toContain("private_encrypted_jsonl_record_v2");
    expect(raw).not.toContain("private transcript wording");
    await expect(store.readAll()).resolves.toEqual([
      { id: 1, text: "private transcript wording" }
    ]);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("fails closed with the wrong key", async () => {
    const { filePath, store } = await archive();
    await store.append({ id: 1, text: "secret" });
    const wrong = new EncryptedJsonlArchiveV2<RecordV2>({
      filePath,
      encryptionKey: "different-private-archive-key-long-enough",
      validate: (value) => value as RecordV2
    });

    await expect(wrong.readAll()).rejects.toBeInstanceOf(
      PrivateArchiveEncryptionError
    );
  });

  it("atomically migrates legacy plaintext JSONL on first read", async () => {
    const { filePath, store } = await archive();
    await fs.writeFile(filePath, [
      JSON.stringify({ id: 1, text: "legacy one" }),
      JSON.stringify({ id: 2, text: "legacy two" })
    ].join("\n") + "\n", { mode: 0o600 });

    await expect(store.readAll()).resolves.toEqual([
      { id: 1, text: "legacy one" },
      { id: 2, text: "legacy two" }
    ]);
    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).not.toContain("legacy one");
    expect(raw.trim().split("\n")).toHaveLength(2);
  });

  it("serializes concurrent appends and supports bounded recent reads", async () => {
    const { store } = await archive();
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.append({ id: index, text: `record ${index}` })
    ));

    expect((await store.readAll()).map((item) => item.id))
      .toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect((await store.readRecent(3)).map((item) => item.id))
      .toEqual([17, 18, 19]);
  });

  it("clears the archive and matching crash-left temporary files only", async () => {
    const { directory, filePath, store } = await archive();
    await store.append({ id: 1, text: "private" });
    const matching = `${filePath}.old.tmp`;
    const unrelated = path.join(directory, "other.jsonl.old.tmp");
    await fs.writeFile(matching, "private");
    await fs.writeFile(unrelated, "keep");

    await store.clear();

    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(matching)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(unrelated, "utf8")).resolves.toBe("keep");
  });
});
