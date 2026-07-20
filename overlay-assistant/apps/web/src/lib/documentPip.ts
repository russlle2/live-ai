export type DocumentPictureInPictureApi = {
  requestWindow(options: {
    width: number;
    height: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
  window?: Window | null;
};

export type WindowWithDocumentPip = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi;
};

export function documentPipSupported(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const api = (value as {
    documentPictureInPicture?: { requestWindow?: unknown };
  }).documentPictureInPicture;
  return typeof api?.requestWindow === "function";
}

export function sanitizePipSize(
  width: number,
  height: number
): { width: number; height: number } {
  const safeWidth = Number.isFinite(width) ? width : 480;
  const safeHeight = Number.isFinite(height) ? height : 320;
  return {
    width: Math.round(Math.min(960, Math.max(320, safeWidth))),
    height: Math.round(Math.min(720, Math.max(180, safeHeight)))
  };
}

export async function openGuidancePip(
  host: WindowWithDocumentPip = window as WindowWithDocumentPip,
  requestedSize = { width: 480, height: 320 }
): Promise<Window> {
  const api = host.documentPictureInPicture;
  if (!api || !documentPipSupported(host)) {
    throw new Error("Always-on-top guidance is not supported by this browser.");
  }
  if (api.window && !api.window.closed) return api.window;
  const size = sanitizePipSize(requestedSize.width, requestedSize.height);
  const pipWindow = await api.requestWindow({
    ...size,
    preferInitialWindowPlacement: true
  });
  copyDocumentStyles(host.document, pipWindow.document);
  pipWindow.document.title = "Live Rhetoric guidance";
  pipWindow.document.body.className = "pip-guidance-body";
  return pipWindow;
}

function copyDocumentStyles(source: Document, target: Document): void {
  for (const styleSheet of Array.from(source.styleSheets)) {
    if (styleSheet.href) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = styleSheet.href;
      target.head.append(link);
      continue;
    }
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      target.head.append(style);
    } catch {
      // Cross-origin styles cannot be inspected; the app's own stylesheet is same-origin.
    }
  }
}
