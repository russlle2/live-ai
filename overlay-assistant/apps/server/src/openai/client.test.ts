import { describe, expect, it } from "vitest";
import {
  resolveCoachingProviderConfig,
  validateLocalAiBaseUrl
} from "./client.js";

describe("local-first coaching provider selection", () => {
  it("prefers a configured loopback model over cloud coaching", () => {
    expect(resolveCoachingProviderConfig({
      localBaseUrl: "http://127.0.0.1:11434/v1",
      localModel: "qwen-local",
      cloudApiKey: "cloud-key",
      cloudModel: "cloud-model"
    })).toEqual({
      kind: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "local-only",
      model: "qwen-local"
    });
  });

  it("preserves cloud coaching when no local runtime is configured", () => {
    expect(resolveCoachingProviderConfig({
      localBaseUrl: "",
      localModel: "",
      cloudApiKey: "cloud-key",
      cloudModel: "cloud-model"
    })).toEqual({
      kind: "cloud",
      apiKey: "cloud-key",
      model: "cloud-model"
    });
  });

  it("returns null when neither provider is usable", () => {
    expect(resolveCoachingProviderConfig({
      localBaseUrl: "",
      localModel: "",
      cloudApiKey: "",
      cloudModel: "cloud-model"
    })).toBeNull();
  });

  it.each([
    "https://example.com/v1",
    "http://192.168.1.10:11434/v1",
    "file:///models",
    "not-a-url"
  ])("rejects a non-loopback local inference endpoint", (value) => {
    expect(() => validateLocalAiBaseUrl(value)).toThrow(/loopback|URL|http/i);
  });

  it("accepts normalized localhost endpoints", () => {
    expect(validateLocalAiBaseUrl("http://localhost:11434/v1/"))
      .toBe("http://localhost:11434/v1");
  });
});
