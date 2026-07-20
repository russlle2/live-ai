export type SessionDeviceRoleV2 = "audio_host" | "companion";

type SessionDevices<T> = {
  audioHost: T | null;
  companions: Set<T>;
};

export class SessionDeviceRegistryV2<T> {
  private readonly sessions = new Map<string, SessionDevices<T>>();

  register(
    sessionId: string,
    client: T,
    role: SessionDeviceRoleV2
  ): { ok: true } | { ok: false; code: "audio_host_already_connected" } {
    const devices = this.sessions.get(sessionId) ?? {
      audioHost: null,
      companions: new Set<T>()
    };
    if (
      role === "audio_host" &&
      devices.audioHost !== null &&
      devices.audioHost !== client
    ) {
      return { ok: false, code: "audio_host_already_connected" };
    }
    if (role === "audio_host") devices.audioHost = client;
    else devices.companions.add(client);
    this.sessions.set(sessionId, devices);
    return { ok: true };
  }

  release(sessionId: string, client: T): boolean {
    const devices = this.sessions.get(sessionId);
    if (!devices) return false;
    let removed = devices.companions.delete(client);
    if (devices.audioHost === client) {
      devices.audioHost = null;
      removed = true;
    }
    if (devices.audioHost === null && devices.companions.size === 0) {
      this.sessions.delete(sessionId);
    }
    return removed;
  }

  snapshot(sessionId: string): {
    audioHost: T | null;
    companions: T[];
  } {
    const devices = this.sessions.get(sessionId);
    return {
      audioHost: devices?.audioHost ?? null,
      companions: [...(devices?.companions ?? [])]
    };
  }

  clearSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  clearAll(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  get size(): number {
    return this.sessions.size;
  }
}
