/** Browser WebSockets carry an Origin header; non-browser clients may omit it. */
export function isAllowedWebSocketOrigin(origin: string | undefined, configuredOrigin: string): boolean {
  if (!origin) return true;
  if (configuredOrigin === "*") return false;
  try {
    return new URL(origin).origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}
