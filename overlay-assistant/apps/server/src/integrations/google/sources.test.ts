import { describe, expect, it } from "vitest";
import { readDriveFile, readGmailMessage, syncGmail } from "./sources.js";
import { GmailSyncStateSchema, type GmailSyncState, type SourceDocument } from "./types.js";
import type { GoogleReadonlyClient } from "./client.js";

describe("resumable Gmail synchronization", () => {
  it("checkpoints a bounded batch and resumes pending message IDs without rescanning", async () => {
    const calls: string[] = [];
    const fakeClient = {
      json: async (input: string | URL) => {
        const url = new URL(String(input));
        calls.push(`${url.pathname}?${url.searchParams.toString()}`);
        if (url.pathname.endsWith("/profile")) return { historyId: "100", emailAddress: "owner@example.com" };
        if (url.pathname.endsWith("/messages")) return { messages: [{ id: "m1" }, { id: "m2" }] };
        if (url.pathname.endsWith("/history")) return { history: [], historyId: "100" };
        const id = url.pathname.split("/").at(-1)!;
        return {
          id,
          internalDate: "1783944000000",
          payload: {
            headers: [
              { name: "Subject", value: `Message ${id}` },
              { name: "From", value: "Owner <owner@example.com>" },
              { name: "To", value: "Client <client@example.com>" }
            ],
            mimeType: "text/plain",
            body: { data: Buffer.from(`Useful body ${id}`).toString("base64url") }
          }
        };
      }
    } as unknown as GoogleReadonlyClient;
    let state: GmailSyncState = GmailSyncStateSchema.parse({ phase: "bootstrap" });
    const documents: SourceDocument[] = [];
    const callbacks = (limit: number) => ({
      state,
      limit,
      maxPages: 2,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      checkpoint: async (next: GmailSyncState) => { state = structuredClone(next); },
      onDocument: async (document: SourceDocument) => { documents.push(document); },
      onDelete: async () => {}
    });

    expect(await syncGmail(fakeClient, callbacks(1))).toBe(1);
    expect(state.phase).toBe("bootstrap");
    expect(state.pendingMessageIds).toEqual(["m2"]);
    expect(documents.map((item) => item.externalId)).toEqual(["m1"]);

    expect(await syncGmail(fakeClient, callbacks(2))).toBe(1);
    expect(state.phase).toBe("incremental");
    expect(state.historyId).toBe("100");
    expect(documents.map((item) => item.externalId)).toEqual(["m1", "m2"]);
    expect(documents.every((item) => item.gmailAuthorship?.authorRelationship === "owner")).toBe(true);
    expect(calls.filter((call) => call.includes("/messages?"))).toHaveLength(1);
  });

  it("checkpoints and emits Gmail deletions from incremental history", async () => {
    const fakeClient = {
      json: async () => ({
        history: [{
          messagesDeleted: [
            { message: { id: "deleted-1" } },
            { message: { id: "deleted-2" } }
          ]
        }],
        historyId: "102"
      })
    } as unknown as GoogleReadonlyClient;
    let state: GmailSyncState = GmailSyncStateSchema.parse({
      phase: "incremental",
      historyId: "100"
    });
    const deleted: string[] = [];
    const callbacks = (limit: number) => ({
      state,
      limit,
      maxPages: 2,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      checkpoint: async (next: GmailSyncState) => { state = structuredClone(next); },
      onDocument: async () => {},
      onDelete: async (sourceRef: string) => { deleted.push(sourceRef); }
    });

    expect(await syncGmail(fakeClient, callbacks(1))).toBe(1);
    expect(deleted).toEqual(["gmail:deleted-1"]);
    expect(state.pendingDeletedMessageIds).toEqual(["deleted-2"]);
    expect(state.historyId).toBe("100");

    expect(await syncGmail(fakeClient, callbacks(1))).toBe(1);
    expect(deleted).toEqual(["gmail:deleted-1", "gmail:deleted-2"]);
    expect(state.pendingDeletedMessageIds).toEqual([]);
    expect(state.historyId).toBe("102");
  });
});

describe("Google source metadata privacy", () => {
  it("sanitizes a Gmail subject before document storage", async () => {
    const secret = "sk-example-super-secret-token-value";
    const fakeClient = {
      json: async () => ({
        id: "gmail-secret",
        internalDate: "1783944000000",
        payload: {
          headers: [{ name: "Subject", value: `API key: ${secret}` }],
          mimeType: "text/plain",
          body: { data: Buffer.from("Useful customer support evidence.").toString("base64url") }
        }
      })
    } as unknown as GoogleReadonlyClient;

    const document = await readGmailMessage(fakeClient, "gmail-secret");

    expect(document.title).not.toContain(secret);
    expect(document.text).not.toContain(secret);
    expect(document.reviewFlags.some((flag) => flag.startsWith("excluded:credential"))).toBe(true);
  });

  it("removes exact contact and address details from Gmail headers and bodies", async () => {
    const fakeClient = {
      json: async () => ({
        id: "gmail-contact",
        internalDate: "1783944000000",
        payload: {
          headers: [
            { name: "Subject", value: "Interview follow-up" },
            { name: "From", value: "Hiring Person <hiring@example.com>" },
            { name: "To", value: "Owner <owner@example.com>" }
          ],
          mimeType: "text/plain",
          body: {
            data: Buffer.from("Call (212) 555-0199 or visit 123 Main Street.").toString("base64url")
          }
        }
      })
    } as unknown as GoogleReadonlyClient;

    const document = await readGmailMessage(fakeClient, "gmail-contact", "owner@example.com");
    expect(document.text).not.toContain("hiring@example.com");
    expect(document.text).not.toContain("owner@example.com");
    expect(document.text).not.toContain("212) 555-0199");
    expect(document.text).not.toContain("123 Main Street");
    expect(document.reviewFlags).toEqual(expect.arrayContaining([
      "excluded:phone_number",
      "excluded:street_address"
    ]));
    expect(document.gmailAuthorship).toEqual({
      authorRelationship: "correspondent",
      direction: "inbound"
    });
    expect(document.text).toContain("From role: correspondent");
    expect(document.text).toContain("Direction: inbound");
  });

  it("derives owner-authored outbound direction without storing either address", async () => {
    const fakeClient = {
      json: async () => ({
        id: "gmail-outbound",
        payload: {
          headers: [
            { name: "Subject", value: "Project update" },
            { name: "From", value: "Owner <OWNER@example.com>" },
            { name: "To", value: "Client <client@example.com>" }
          ],
          mimeType: "text/plain",
          body: { data: Buffer.from("I delivered the migration.").toString("base64url") }
        }
      })
    } as unknown as GoogleReadonlyClient;

    const document = await readGmailMessage(fakeClient, "gmail-outbound", "owner@example.com");
    expect(document.gmailAuthorship).toEqual({
      authorRelationship: "owner",
      direction: "outbound"
    });
    expect(document.text).not.toContain("owner@example.com");
    expect(document.text).not.toContain("client@example.com");
  });

  it("sanitizes a Drive filename before document storage", async () => {
    const secret = "open-sesame-987654";
    const fakeClient = {
      json: async () => ({
        id: "drive-secret",
        name: `Password: ${secret}`,
        mimeType: "text/plain",
        modifiedTime: "2026-07-13T00:00:00.000Z"
      }),
      text: async () => "Useful IT support evidence."
    } as unknown as GoogleReadonlyClient;

    const document = await readDriveFile(fakeClient, "drive-secret");

    expect(document.title).not.toContain(secret);
    expect(document.text).not.toContain(secret);
    expect(document.reviewFlags).toContain("excluded:credential_line");
  });
});
