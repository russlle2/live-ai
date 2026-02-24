/** Derive server base URL from current page host — works in dev and production */
const SERVER_PORT = (import.meta as any).env?.VITE_SERVER_PORT || "8081";
export const API_BASE = `http://${window.location.hostname}:${SERVER_PORT}`;
export const WS_URL = `ws://${window.location.hostname}:${SERVER_PORT}/ws`;
export const API_KEY: string | undefined = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;
export function apiHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...(API_KEY ? { "x-overlay-key": API_KEY } : {}) };
}
