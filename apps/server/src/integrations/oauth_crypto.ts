import crypto from "crypto";

function getEncKey(): Buffer {
  const raw = (process.env.OAUTH_TOKEN_ENC_KEY || "").trim();
  if (!raw) {
    throw new Error("oauth_enc_key_missing");
  }

  const asHex = /^[0-9a-fA-F]+$/.test(raw) && raw.length === 64 ? Buffer.from(raw, "hex") : null;
  if (asHex && asHex.length === 32) return asHex;

  try {
    const asB64 = Buffer.from(raw, "base64");
    if (asB64.length === 32) return asB64;
  } catch {
    // ignore
  }

  throw new Error("oauth_enc_key_invalid");
}

export function encryptToken(value: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptToken(payload: string): string {
  const key = getEncKey();
  const [ivB64, tagB64, dataB64] = String(payload || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("oauth_token_payload_invalid");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}
