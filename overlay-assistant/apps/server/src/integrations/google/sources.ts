import {
  DriveSyncStateSchema,
  GmailSyncStateSchema,
  SourceDocumentSchema,
  type DriveSyncState,
  type GmailAuthorshipContext,
  type GmailSyncState,
  type SourceDocument
} from "./types.js";
import { GoogleApiError, GoogleReadonlyClient } from "./client.js";
import {
  classifySensitivity,
  contentHash,
  sanitizeGoogleSourceTitle,
  sanitizeGoogleSourceText,
  stripHtml
} from "./privacy.js";

type SyncCallbacks<State> = {
  state: State;
  limit: number;
  maxPages: number;
  now: () => Date;
  checkpoint: (state: State) => Promise<void>;
  onDocument: (document: SourceDocument) => Promise<void>;
  onDelete: (sourceRef: string) => Promise<void>;
  query?: string;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
  labelIds?: string[];
};

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

type DriveMetadata = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  description?: string;
  webViewLink?: string;
  trashed?: boolean;
  size?: string;
};

export async function syncGmail(
  client: GoogleReadonlyClient,
  callbacks: SyncCallbacks<GmailSyncState>
): Promise<number> {
  let state = GmailSyncStateSchema.parse(callbacks.state);
  let processed = 0;
  let pages = 0;

  // The profile address is held only for this run. It is used locally to turn
  // From/To headers into non-identifying owner/correspondent roles and is
  // never written into cached source text or model context.
  const profile = await client.json<{ historyId: string; emailAddress?: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile"
  );
  const ownerEmail = normalizeEmail(profile.emailAddress);

  const save = async () => {
    state.lastSyncAt = callbacks.now().toISOString();
    await callbacks.checkpoint(GmailSyncStateSchema.parse(state));
  };

  if (state.phase === "bootstrap" && !state.bootstrapHistoryId) {
    state.bootstrapHistoryId = profile.historyId;
    await save();
  }

  while (processed < callbacks.limit && pages < callbacks.maxPages) {
    if (state.phase === "bootstrap") {
      if (state.pendingMessageIds.length === 0) {
        const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        url.searchParams.set("maxResults", String(Math.min(100, callbacks.limit - processed)));
        if (callbacks.query) url.searchParams.set("q", callbacks.query);
        if (state.listPageToken) url.searchParams.set("pageToken", state.listPageToken);
        const response = await client.json<{
          messages?: Array<{ id: string }>;
          nextPageToken?: string;
        }>(url);
        pages += 1;
        state.pendingMessageIds = [...new Set((response.messages ?? []).map((message) => message.id))];
        state.pendingListNextPageToken = response.nextPageToken;
        await save();

        if (state.pendingMessageIds.length === 0) {
          if (state.pendingListNextPageToken) {
            state.listPageToken = state.pendingListNextPageToken;
            state.pendingListNextPageToken = undefined;
            await save();
            continue;
          }
          state = GmailSyncStateSchema.parse({
            phase: "incremental",
            historyId: state.bootstrapHistoryId,
            lastSyncAt: callbacks.now().toISOString()
          });
          await callbacks.checkpoint(state);
          continue;
        }
      }

      while (state.pendingMessageIds.length > 0 && processed < callbacks.limit) {
        const id = state.pendingMessageIds[0]!;
        try {
          const document = await readGmailMessage(client, id, ownerEmail);
          await callbacks.onDocument(document);
        } catch (error) {
          if (!(error instanceof GoogleApiError && error.status === 404)) throw error;
          await callbacks.onDelete(`gmail:${id}`);
        }
        state.pendingMessageIds.shift();
        processed += 1;
        await save();
      }

      if (state.pendingMessageIds.length === 0) {
        if (state.pendingListNextPageToken) {
          state.listPageToken = state.pendingListNextPageToken;
          state.pendingListNextPageToken = undefined;
        } else {
          state = GmailSyncStateSchema.parse({
            phase: "incremental",
            historyId: state.bootstrapHistoryId,
            lastSyncAt: callbacks.now().toISOString()
          });
        }
        await callbacks.checkpoint(state);
      }
      continue;
    }

    if (!state.historyId) {
      state = GmailSyncStateSchema.parse({ phase: "bootstrap" });
      await callbacks.checkpoint(state);
      continue;
    }

    if (state.pendingMessageIds.length === 0 && state.pendingDeletedMessageIds.length === 0) {
      if (!state.historyAnchorId) state.historyAnchorId = state.historyId;
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
      url.searchParams.set("startHistoryId", state.historyAnchorId);
      url.searchParams.append("historyTypes", "messageAdded");
      url.searchParams.append("historyTypes", "messageDeleted");
      url.searchParams.set("maxResults", String(Math.min(100, callbacks.limit - processed)));
      if (state.historyPageToken) url.searchParams.set("pageToken", state.historyPageToken);
      let response: {
        history?: Array<{
          messagesAdded?: Array<{ message?: { id?: string } }>;
          messagesDeleted?: Array<{ message?: { id?: string } }>;
        }>;
        nextPageToken?: string;
        historyId?: string;
      };
      try {
        response = await client.json(url);
      } catch (error) {
        // Gmail returns 404 when a history cursor is too old. A bounded bootstrap
        // is safer than silently skipping the gap.
        if (error instanceof GoogleApiError && error.status === 404) {
          state = GmailSyncStateSchema.parse({ phase: "bootstrap" });
          await callbacks.checkpoint(state);
          continue;
        }
        throw error;
      }
      pages += 1;
      state.pendingMessageIds = [...new Set(
        (response.history ?? []).flatMap((item) =>
          (item.messagesAdded ?? []).map((entry) => entry.message?.id).filter((id): id is string => Boolean(id))
        )
      )];
      state.pendingDeletedMessageIds = [...new Set(
        (response.history ?? []).flatMap((item) =>
          (item.messagesDeleted ?? []).map((entry) => entry.message?.id).filter((id): id is string => Boolean(id))
        )
      )];
      state.pendingHistoryNextPageToken = response.nextPageToken;
      state.pendingHistoryLatestId = response.historyId ?? state.pendingHistoryLatestId ?? state.historyId;
      await save();
    }

    while (state.pendingMessageIds.length > 0 && processed < callbacks.limit) {
      const id = state.pendingMessageIds[0]!;
      try {
        await callbacks.onDocument(await readGmailMessage(client, id, ownerEmail));
      } catch (error) {
        // A message can disappear between history listing and retrieval.
        if (!(error instanceof GoogleApiError && error.status === 404)) throw error;
        await callbacks.onDelete(`gmail:${id}`);
      }
      state.pendingMessageIds.shift();
      processed += 1;
      await save();
    }

    while (state.pendingDeletedMessageIds.length > 0 && processed < callbacks.limit) {
      const id = state.pendingDeletedMessageIds[0]!;
      await callbacks.onDelete(`gmail:${id}`);
      state.pendingDeletedMessageIds.shift();
      processed += 1;
      await save();
    }

    if (state.pendingMessageIds.length === 0 && state.pendingDeletedMessageIds.length === 0) {
      if (state.pendingHistoryNextPageToken) {
        state.historyPageToken = state.pendingHistoryNextPageToken;
        state.pendingHistoryNextPageToken = undefined;
      } else {
        state.historyId = state.pendingHistoryLatestId ?? state.historyId;
        state.historyAnchorId = undefined;
        state.historyPageToken = undefined;
        state.pendingHistoryLatestId = undefined;
      }
      await save();
      if (!state.historyAnchorId) break;
    }
  }
  return processed;
}

export async function syncDrive(
  client: GoogleReadonlyClient,
  callbacks: SyncCallbacks<DriveSyncState>
): Promise<number> {
  let state = DriveSyncStateSchema.parse(callbacks.state);
  let processed = 0;
  let pages = 0;

  const save = async () => {
    state.lastSyncAt = callbacks.now().toISOString();
    await callbacks.checkpoint(DriveSyncStateSchema.parse(state));
  };

  if (state.phase === "bootstrap" && !state.bootstrapChangesToken) {
    const response = await client.json<{ startPageToken: string }>(
      "https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true"
    );
    state.bootstrapChangesToken = response.startPageToken;
    await save();
  }

  while (processed < callbacks.limit && pages < callbacks.maxPages) {
    if (state.phase === "bootstrap") {
      if (state.pendingFiles.length === 0) {
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", callbacks.query || DEFAULT_DRIVE_QUERY);
        url.searchParams.set("spaces", "drive");
        url.searchParams.set("pageSize", String(Math.min(100, callbacks.limit - processed)));
        url.searchParams.set("fields", "nextPageToken,files(id)");
        url.searchParams.set("orderBy", "modifiedTime desc");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        if (state.listPageToken) url.searchParams.set("pageToken", state.listPageToken);
        const response = await client.json<{
          files?: Array<{ id: string }>;
          nextPageToken?: string;
        }>(url);
        pages += 1;
        state.pendingFiles = (response.files ?? []).map((file) => ({ id: file.id, removed: false }));
        state.pendingListNextPageToken = response.nextPageToken;
        await save();

        if (state.pendingFiles.length === 0) {
          if (state.pendingListNextPageToken) {
            state.listPageToken = state.pendingListNextPageToken;
            state.pendingListNextPageToken = undefined;
            await save();
            continue;
          }
          state = DriveSyncStateSchema.parse({
            phase: "incremental",
            changesPageToken: state.bootstrapChangesToken,
            lastSyncAt: callbacks.now().toISOString()
          });
          await callbacks.checkpoint(state);
          continue;
        }
      }

      processed += await drainDriveFiles(client, callbacks, state, callbacks.limit - processed, save);
      if (state.pendingFiles.length === 0) {
        if (state.pendingListNextPageToken) {
          state.listPageToken = state.pendingListNextPageToken;
          state.pendingListNextPageToken = undefined;
        } else {
          state = DriveSyncStateSchema.parse({
            phase: "incremental",
            changesPageToken: state.bootstrapChangesToken,
            lastSyncAt: callbacks.now().toISOString()
          });
        }
        await callbacks.checkpoint(state);
      }
      continue;
    }

    if (!state.changesPageToken) {
      state = DriveSyncStateSchema.parse({ phase: "bootstrap" });
      await callbacks.checkpoint(state);
      continue;
    }

    if (state.pendingFiles.length === 0) {
      if (!state.changesAnchorToken) state.changesAnchorToken = state.changesPageToken;
      const url = new URL("https://www.googleapis.com/drive/v3/changes");
      url.searchParams.set("pageToken", state.changesAnchorToken);
      url.searchParams.set("pageSize", String(Math.min(100, callbacks.limit - processed)));
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("includeRemoved", "true");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("fields", "nextPageToken,newStartPageToken,changes(fileId,removed)");
      let response: {
        changes?: Array<{ fileId: string; removed?: boolean }>;
        nextPageToken?: string;
        newStartPageToken?: string;
      };
      try {
        response = await client.json(url);
      } catch (error) {
        if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) {
          state = DriveSyncStateSchema.parse({ phase: "bootstrap" });
          await callbacks.checkpoint(state);
          continue;
        }
        throw error;
      }
      pages += 1;
      state.pendingFiles = (response.changes ?? []).map((change) => ({
        id: change.fileId,
        removed: Boolean(change.removed)
      }));
      state.pendingChangesNextPageToken = response.nextPageToken;
      state.pendingChangesNewStartToken = response.newStartPageToken;
      await save();
    }

    processed += await drainDriveFiles(client, callbacks, state, callbacks.limit - processed, save);
    if (state.pendingFiles.length === 0) {
      if (state.pendingChangesNextPageToken) {
        state.changesAnchorToken = state.pendingChangesNextPageToken;
        state.pendingChangesNextPageToken = undefined;
      } else {
        state.changesPageToken = state.pendingChangesNewStartToken ?? state.changesPageToken;
        state.changesAnchorToken = undefined;
        state.pendingChangesNewStartToken = undefined;
      }
      await save();
      if (!state.changesAnchorToken) break;
    }
  }
  return processed;
}

async function drainDriveFiles(
  client: GoogleReadonlyClient,
  callbacks: SyncCallbacks<DriveSyncState>,
  state: DriveSyncState,
  limit: number,
  save: () => Promise<void>
): Promise<number> {
  let processed = 0;
  while (state.pendingFiles.length > 0 && processed < limit) {
    const pointer = state.pendingFiles[0]!;
    if (pointer.removed) {
      await callbacks.onDelete(`drive:${pointer.id}`);
    } else {
      try {
        await callbacks.onDocument(await readDriveFile(client, pointer.id));
      } catch (error) {
        if (!(error instanceof GoogleApiError && [403, 404, 415].includes(error.status))) throw error;
        await callbacks.onDelete(`drive:${pointer.id}`);
      }
    }
    state.pendingFiles.shift();
    processed += 1;
    await save();
  }
  return processed;
}

export async function readGmailMessage(
  client: GoogleReadonlyClient,
  id: string,
  ownerEmail?: string
): Promise<SourceDocument> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "full");
  const message = await client.json<GmailMessage>(url);
  if (message.labelIds?.some((label) => label === "SPAM" || label === "TRASH")) {
    throw new GoogleApiError("Gmail message is outside the configured import scope", 404);
  }
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [header.name?.toLowerCase() ?? "", header.value ?? ""])
  );
  const body = extractGmailBody(message.payload);
  const sanitizedSubject = sanitizeGoogleSourceTitle(
    headers.get("subject") || "Untitled Gmail message",
    "Untitled Gmail message"
  );
  const subject = sanitizedSubject.text;
  const gmailAuthorship = deriveGmailAuthorship(
    normalizeEmail(ownerEmail),
    headers.get("from"),
    headers.get("to")
  );
  const rawText = [
    `Subject: ${subject}`,
    `From role: ${gmailAuthorship.authorRelationship}`,
    `Direction: ${gmailAuthorship.direction}`,
    headers.get("date") ? `Date: ${headers.get("date")}` : "",
    "",
    body.text || message.snippet || ""
  ].filter((line) => line !== "").join("\n");
  const sanitized = sanitizeGoogleSourceText(rawText);
  const timestamp = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : parseDate(headers.get("date"));
  const reviewFlags = [...sanitizedSubject.exclusions, ...sanitized.exclusions]
    .map((value) => `excluded:${value}`);
  if (body.hasAttachment) reviewFlags.push("attachment_binaries_excluded");
  return SourceDocumentSchema.parse({
    sourceType: "gmail",
    sourceRef: `gmail:${message.id}`,
    externalId: message.id,
    title: subject.slice(0, 500),
    timestamp,
    mimeType: "message/rfc822",
    webUrl: `https://mail.google.com/mail/u/0/#all/${message.id}`,
    text: sanitized.text,
    contentHash: contentHash(sanitized.text),
    sensitivity: classifySensitivity(sanitized.text),
    reviewFlags,
    gmailAuthorship
  });
}

function deriveGmailAuthorship(
  ownerEmail: string | undefined,
  fromHeader: string | undefined,
  toHeader: string | undefined
): GmailAuthorshipContext {
  if (!ownerEmail) return { authorRelationship: "unknown", direction: "unknown" };
  const fromAddresses = extractEmailAddresses(fromHeader);
  const toAddresses = extractEmailAddresses(toHeader);
  const ownerInFrom = fromAddresses.includes(ownerEmail);
  const ownerInTo = toAddresses.includes(ownerEmail);

  if (ownerInFrom && ownerInTo) return { authorRelationship: "owner", direction: "self" };
  if (ownerInFrom) return { authorRelationship: "owner", direction: "outbound" };
  if (ownerInTo) {
    return {
      authorRelationship: fromAddresses.length > 0 ? "correspondent" : "unknown",
      direction: "inbound"
    };
  }
  return { authorRelationship: "unknown", direction: "unknown" };
}

function extractEmailAddresses(header: string | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => normalizeEmail(match[0]))
    .filter((value): value is string => Boolean(value));
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

export async function readDriveFile(client: GoogleReadonlyClient, id: string): Promise<SourceDocument> {
  const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  metadataUrl.searchParams.set(
    "fields",
    "id,name,mimeType,modifiedTime,createdTime,description,webViewLink,trashed,size"
  );
  metadataUrl.searchParams.set("supportsAllDrives", "true");
  const metadata = await client.json<DriveMetadata>(metadataUrl);
  if (metadata.trashed) throw new GoogleApiError("Drive file is trashed", 404);

  const sanitizedName = sanitizeGoogleSourceTitle(
    metadata.name ?? "Untitled Drive file",
    "Untitled Drive file"
  );
  const reviewFlags: string[] = sanitizedName.exclusions.map((value) => `excluded:${value}`);
  let extractedText = "";
  const mimeType = metadata.mimeType ?? "application/octet-stream";
  if (!isSupportedDriveMimeType(mimeType)) {
    throw new GoogleApiError("Drive file type is outside the configured import scope", 415);
  }
  try {
    if (mimeType === "application/vnd.google-apps.document") {
      extractedText = await exportDriveFile(client, id, "text/plain");
    } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      extractedText = await exportDriveFile(client, id, "text/csv");
    } else if (mimeType === "application/vnd.google-apps.presentation") {
      extractedText = await exportDriveFile(client, id, "text/plain");
    } else if (isTextMimeType(mimeType)) {
      const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
      mediaUrl.searchParams.set("alt", "media");
      mediaUrl.searchParams.set("supportsAllDrives", "true");
      extractedText = await client.text(mediaUrl);
    } else if (mimeType === "application/pdf") {
      reviewFlags.push("pdf_metadata_only");
    } else {
      reviewFlags.push("binary_content_excluded");
    }
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw error;
    reviewFlags.push(`content_unavailable:${error.status}`);
  }

  const rawText = [
    `Title: ${sanitizedName.text}`,
    `Type: ${mimeType}`,
    metadata.createdTime ? `Created: ${metadata.createdTime}` : "",
    metadata.modifiedTime ? `Modified: ${metadata.modifiedTime}` : "",
    metadata.description ? `Description: ${metadata.description}` : "",
    "",
    extractedText
  ].filter((line) => line !== "").join("\n");
  const sanitized = sanitizeGoogleSourceText(rawText);
  reviewFlags.push(...sanitized.exclusions.map((value) => `excluded:${value}`));
  return SourceDocumentSchema.parse({
    sourceType: "drive",
    sourceRef: `drive:${metadata.id}`,
    externalId: metadata.id,
    title: sanitizedName.text,
    timestamp: metadata.modifiedTime ?? metadata.createdTime,
    mimeType,
    webUrl: metadata.webViewLink,
    text: sanitized.text,
    contentHash: contentHash(sanitized.text),
    sensitivity: classifySensitivity(sanitized.text),
    reviewFlags: [...new Set(reviewFlags)].sort()
  });
}

function extractGmailBody(payload?: GmailPart): { text: string; hasAttachment: boolean } {
  const plain: string[] = [];
  const html: string[] = [];
  let hasAttachment = false;
  const visit = (part?: GmailPart) => {
    if (!part) return;
    if (part.body?.attachmentId || part.filename) hasAttachment = true;
    if (part.body?.data && !part.body.attachmentId) {
      const decoded = Buffer.from(part.body.data, "base64url").toString("utf8");
      if (part.mimeType === "text/plain") plain.push(decoded);
      else if (part.mimeType === "text/html") html.push(stripHtml(decoded));
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  return {
    text: (plain.length > 0 ? plain : html).join("\n\n"),
    hasAttachment
  };
}

async function exportDriveFile(client: GoogleReadonlyClient, id: string, mimeType: string): Promise<string> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export`);
  url.searchParams.set("mimeType", mimeType);
  return client.text(url);
}

function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || [
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/javascript"
  ].includes(mimeType);
}

const SUPPORTED_DRIVE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript"
] as const;

export const DEFAULT_DRIVE_QUERY = `trashed = false and (${SUPPORTED_DRIVE_MIME_TYPES
  .map((mimeType) => `mimeType = '${mimeType}'`)
  .join(" or ")})`;

function isSupportedDriveMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || SUPPORTED_DRIVE_MIME_TYPES.includes(
    mimeType as (typeof SUPPORTED_DRIVE_MIME_TYPES)[number]
  );
}

function parseDate(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
