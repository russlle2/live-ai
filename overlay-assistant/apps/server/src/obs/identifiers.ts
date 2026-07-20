import { createHmac, randomBytes } from "node:crypto";
import { CONFIG } from "../config.js";

export type OpaqueIdentifierKind = "tenant" | "rep" | "session";

const processRandomLogSalt = randomBytes(32).toString("hex");

/** Stable for a configured secret while ensuring raw identifiers never enter telemetry. */
export function opaqueLogIdentifier(
  kind: OpaqueIdentifierKind,
  value?: string,
  secret = CONFIG.jwtSecret || processRandomLogSalt
): string | undefined {
  if (!value) return undefined;
  const digest = createHmac("sha256", secret || processRandomLogSalt)
    .update(value)
    .digest("hex")
    .slice(0, 20);
  return `${kind}_${digest}`;
}

/** Convert a raw authenticated tenant ID into the exact key stored by emitLog. */
export function storedTelemetryTenantId(
  tenantId: string,
  secret?: string
): string {
  if (!tenantId) throw new TypeError("tenantId is required for telemetry lookup");
  const stored = opaqueLogIdentifier("tenant", tenantId, secret);
  if (!stored) throw new TypeError("tenantId is required for telemetry lookup");
  return stored;
}
