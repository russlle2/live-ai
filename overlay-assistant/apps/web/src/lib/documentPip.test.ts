import { describe, expect, it } from "vitest";
import {
  documentPipSupported,
  sanitizePipSize
} from "./documentPip";

describe("Document Picture-in-Picture support", () => {
  it("requires an actual requestWindow function", () => {
    expect(documentPipSupported({
      documentPictureInPicture: { requestWindow: async () => ({}) }
    })).toBe(true);
    expect(documentPipSupported({ documentPictureInPicture: {} })).toBe(false);
    expect(documentPipSupported({})).toBe(false);
  });

  it("clamps floating overlay dimensions", () => {
    expect(sanitizePipSize(480, 320)).toEqual({ width: 480, height: 320 });
    expect(sanitizePipSize(10, 10)).toEqual({ width: 320, height: 180 });
    expect(sanitizePipSize(10_000, 10_000)).toEqual({ width: 960, height: 720 });
    expect(sanitizePipSize(Number.NaN, Number.NaN)).toEqual({
      width: 480,
      height: 320
    });
  });
});
