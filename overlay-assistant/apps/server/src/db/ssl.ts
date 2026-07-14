import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

export type DatabaseSslSettings = {
  enabled: boolean;
  caFile?: string;
};

/**
 * Build a fail-closed node-postgres TLS policy. Without a custom CA, Node's
 * system trust store is used. node-postgres supplies the URL's DNS hostname as
 * `servername`, so the default TLS identity check validates the certificate.
 */
export function buildDatabaseSslOptions(
  settings: DatabaseSslSettings,
  readTextFile: (filePath: string) => string = (filePath) => readFileSync(filePath, "utf8")
): false | ConnectionOptions {
  if (!settings.enabled) {
    if (settings.caFile) throw new Error("A database CA file cannot be configured while DB_SSL is disabled");
    return false;
  }

  const ca = settings.caFile ? readTextFile(settings.caFile) : undefined;
  if (settings.caFile && !ca?.trim()) {
    throw new Error("DB_SSL_CA_FILE must contain at least one trusted CA certificate");
  }

  return {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    ...(ca ? { ca } : {})
  };
}
