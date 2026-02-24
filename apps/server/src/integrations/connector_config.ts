import type { IntegrationName } from "./integration_interface";
import { getOauthAccessToken, type OAuthProvider } from "./oauth_store";

type ConnectorEnv = {
  endpoint?: string;
  token?: string;
  signingSecret?: string;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseAllowedHosts(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const CONNECTOR_CONFIG = {
  allowlistHosts: parseAllowedHosts(env("INTEGRATION_ALLOWED_HOSTS")),
  requestTimeoutMs: Number(env("INTEGRATION_TIMEOUT_MS") || 7000),
  universalMode: (env("UNIVERSAL_MODE") || "true") === "true",
  zoom: {
    endpoint: env("ZOOM_WEBHOOK_URL"),
    token: env("ZOOM_BEARER_TOKEN"),
    signingSecret: env("ZOOM_SIGNING_SECRET")
  },
  googleMeet: {
    endpoint: env("GOOGLE_MEET_WEBHOOK_URL"),
    token: env("GOOGLE_MEET_BEARER_TOKEN"),
    signingSecret: env("GOOGLE_MEET_SIGNING_SECRET")
  },
  googleWorkspace: {
    endpoint: env("GOOGLE_WORKSPACE_WEBHOOK_URL"),
    token: env("GOOGLE_WORKSPACE_BEARER_TOKEN"),
    signingSecret: env("GOOGLE_WORKSPACE_SIGNING_SECRET")
  },
  serverWebhook: {
    endpoint: env("SERVER_WEBHOOK_URL"),
    token: env("SERVER_WEBHOOK_BEARER_TOKEN"),
    signingSecret: env("SERVER_WEBHOOK_SIGNING_SECRET")
  }
};

export function connectorEnvFor(integration: IntegrationName): ConnectorEnv | null {
  if (integration === "zoom") return CONNECTOR_CONFIG.zoom;
  if (integration === "google_meet") return CONNECTOR_CONFIG.googleMeet;
  if (integration === "google_workspace") return CONNECTOR_CONFIG.googleWorkspace;
  if (integration === "server_webhook") return CONNECTOR_CONFIG.serverWebhook;
  return null;
}

function oauthProviderForIntegration(integration: IntegrationName): OAuthProvider | null {
  if (integration === "zoom") return "zoom";
  if (integration === "google_meet" || integration === "google_workspace") return "google";
  return null;
}

export async function resolveBearerTokenForIntegration(params: {
  tenantId: string;
  integration: IntegrationName;
  staticToken?: string;
}): Promise<string | undefined> {
  if (params.staticToken) return params.staticToken;
  const provider = oauthProviderForIntegration(params.integration);
  if (!provider) return undefined;
  const token = await getOauthAccessToken({ tenantId: params.tenantId, provider });
  return token ?? undefined;
}

export function assertAllowedHost(urlText: string): { ok: true; host: string } | { ok: false; reason: string } {
  try {
    const url = new URL(urlText);
    const host = url.hostname.toLowerCase();
    if (CONNECTOR_CONFIG.allowlistHosts.size === 0) {
      return { ok: false, reason: "integration_allowlist_empty" };
    }
    if (!CONNECTOR_CONFIG.allowlistHosts.has(host)) {
      return { ok: false, reason: "integration_host_not_allowlisted" };
    }
    return { ok: true, host };
  } catch {
    return { ok: false, reason: "integration_invalid_url" };
  }
}
