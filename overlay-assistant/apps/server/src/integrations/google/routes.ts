import { Router, type RequestHandler } from "express";
import type { GoogleMemorySync } from "./sync.js";
import { GoogleOAuthError } from "./oauth.js";

export function createGoogleSyncRouter(
  sync: GoogleMemorySync,
  options: {
    protect: RequestHandler;
    successRedirect?: string;
    runOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  }
): Router {
  const router = Router();
  const runOperation = options.runOperation ?? (<T>(operation: () => Promise<T>) => operation());

  router.get("/status", options.protect, async (_request, response, next) => {
    try {
      const status = await runOperation(() => sync.status());
      const lastSyncAt = [status.state.gmail.lastSyncAt, status.state.drive.lastSyncAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      response.json({
        configured: status.configured,
        authorized: status.authorized,
        oauthExpiresAt: status.oauthExpiresAt,
        scopes: status.scopes,
        cachedSources: status.cachedSources,
        pendingExtraction: status.pendingExtraction,
        lastSyncAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/oauth/start", options.protect, async (_request, response, next) => {
    try {
      const { url } = await runOperation(() => sync.beginAuthorization());
      response.json({ url });
    } catch (error) {
      next(error);
    }
  });

  // Google redirects here without the app's bearer token. OAuth state + PKCE
  // protect this one route; never place other integration operations here.
  router.get("/oauth/callback", async (request, response, next) => {
    try {
      const code = typeof request.query.code === "string" ? request.query.code : "";
      const state = typeof request.query.state === "string" ? request.query.state : "";
      if (!code || !state) throw new GoogleOAuthError("OAuth callback is missing code or state", "invalid_callback");
      await runOperation(() => sync.completeAuthorization({ code, state }));
      // Consent is a one-time action; begin the first catch-up immediately in
      // the background so the redirect never waits on mailbox/Drive ingestion.
      setImmediate(() => {
        void runOperation(() => sync.runOnce()).catch(() => undefined);
      });
      if (options.successRedirect) response.redirect(options.successRedirect);
      else response.type("html").send("<!doctype html><title>Google connected</title><p>Google Drive and Gmail are connected. You can close this tab.</p>");
    } catch (error) {
      next(error);
    }
  });

  router.post("/sync", options.protect, async (_request, response, next) => {
    try {
      response.json(await runOperation(() => sync.runOnce()));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
