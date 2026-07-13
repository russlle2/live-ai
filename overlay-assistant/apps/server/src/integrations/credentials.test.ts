import { afterEach, describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./credentials.js";

const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
});

describe("legacy credential encryption", () => {
  it("fails closed without an exact 32-byte hexadecimal key", () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptCredential("secret")).toThrow(/64 hexadecimal/);
    process.env.CREDENTIAL_ENCRYPTION_KEY = "short";
    expect(() => encryptCredential("secret")).toThrow(/64 hexadecimal/);
  });

  it("round-trips only authenticated, well-formed material", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
    const encrypted = encryptCredential("private-token");
    expect(decryptCredential(encrypted.encrypted, encrypted.iv, encrypted.tag)).toBe("private-token");
    expect(() => decryptCredential(encrypted.encrypted, "bad", encrypted.tag)).toThrow(/malformed/);
  });
});
