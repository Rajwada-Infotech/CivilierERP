import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCameraCapture, classifyCameraError } from "./useCameraCapture";

function namedError(name: string) {
  const e = new Error(name);
  e.name = name;
  return e;
}

function stubGetUserMedia(impl: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
  return (navigator.mediaDevices.getUserMedia as unknown) as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe("classifyCameraError", () => {
  it("maps browser error names to a reason", () => {
    expect(classifyCameraError(namedError("NotAllowedError"))).toBe("denied");
    expect(classifyCameraError(namedError("NotFoundError"))).toBe("no-device");
    expect(classifyCameraError(namedError("NotReadableError"))).toBe("busy");
    expect(classifyCameraError(namedError("Weird"))).toBe("other");
  });
});

describe("useCameraCapture.start", () => {
  it("reports 'denied' when permission is blocked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGetUserMedia(async () => { throw namedError("NotAllowedError"); });
    const { result } = renderHook(() => useCameraCapture());
    let ok = true;
    await act(async () => { ok = await result.current.start(); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("denied");
    expect(result.current.unsupported).toBe(true);
  });

  it("reports 'no-device' when there is no webcam", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGetUserMedia(async () => { throw namedError("NotFoundError"); });
    const { result } = renderHook(() => useCameraCapture());
    await act(async () => { await result.current.start(); });
    expect(result.current.error).toBe("no-device");
  });

  it("falls back to any camera when the environment camera is over-constrained", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const gum = stubGetUserMedia(async (c) => {
      if (typeof c.video === "object") throw namedError("OverconstrainedError");
      return stream;
    });
    const { result } = renderHook(() => useCameraCapture());
    result.current.videoRef.current = { play, srcObject: null } as unknown as HTMLVideoElement;
    let ok = false;
    await act(async () => { ok = await result.current.start(); });
    expect(ok).toBe(true);
    expect(gum).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it("reports 'unsupported' when getUserMedia does not exist", async () => {
    const { result } = renderHook(() => useCameraCapture());
    await act(async () => { await result.current.start(); });
    expect(result.current.error).toBe("unsupported");
  });
});
