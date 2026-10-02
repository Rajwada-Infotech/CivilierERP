import { useCallback, useEffect, useRef, useState } from "react";

// Why the camera could not start — lets the UI tell "no webcam" from
// "permission blocked" from "another app has it" instead of one vague message.
export type CameraError = "insecure" | "unsupported" | "denied" | "no-device" | "busy" | "other";

export function classifyCameraError(err: unknown): CameraError {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no-device";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "other";
}

// Shared across every camera.start() call site so a failure is never just
// silent — CameraCaptureModal.tsx already used this text; centralized here
// so ActivityDetailModal.tsx's own "Open camera" button (which used to
// fall back to a file picker with zero explanation on failure) can show it
// too.
export const CAMERA_ERROR_TEXT: Record<CameraError, string> = {
  denied: "Camera access is blocked. Allow Camera for this site (lock icon in the address bar), then reopen.",
  "no-device": "No camera was found on this device.",
  busy: "The camera is in use by another app. Close it and try again.",
  insecure: "The camera needs a secure (HTTPS) connection.",
  unsupported: "This browser does not support camera capture.",
  other: "Camera not available.",
};

// getUserMedia-backed live camera preview + shutter capture, scoped to
// whatever component calls it — stop() must run on unmount or the "camera
// light stays on" bug follows the user around the app (mobile browsers keep
// the sensor active for as long as any MediaStream referencing it is live,
// regardless of whether the <video> showing it is still on screen).
export function useCameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsActive(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      // getUserMedia only exists in secure contexts (HTTPS or localhost).
      setError(window.isSecureContext === false ? "insecure" : "unsupported");
      setUnsupported(true);
      return false;
    }
    setError(null);
    // Desktop webcams have no "environment"-facing camera, and requesting
    // it as a hard constraint makes getUserMedia reject outright instead of
    // falling back — so ask for it as a soft preference first, and if the
    // browser still can't satisfy it (or any other OverconstrainedError),
    // retry with no facingMode constraint at all before giving up.
    const tryGetStream = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints);

    try {
      let stream: MediaStream;
      try {
        stream = await tryGetStream({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "OverconstrainedError") {
          stream = await tryGetStream({ video: true, audio: false });
        } else {
          throw err;
        }
      }
      streamRef.current = stream;
      // Attaching srcObject here only works when the caller renders <video>
      // unconditionally (CameraCaptureModal.tsx does). A caller that only
      // mounts <video> once isActive is true (ActivityDetailModal.tsx's
      // Photos tab) has videoRef.current still null at this exact point —
      // the element doesn't exist yet, since setIsActive(true) below is
      // what causes React to render it. That silently dropped the stream
      // and never called play(), leaving a permanently black video panel
      // even though the camera really was granted and running (the "camera
      // opens but shows black" bug). The effect further down re-attaches
      // once isActive flips and the element has actually mounted, so this
      // hook works correctly either way the caller structures its JSX.
      setIsActive(true);
      return true;
    } catch (err) {
      // Release a stream we did get but could not play, so the camera light
      // does not stay on after a failed start.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      console.warn("Camera start failed:", err);
      setError(classifyCameraError(err));
      setUnsupported(true);
      return false;
    }
  }, []);

  // Draws the current video frame to an offscreen canvas and encodes it as
  // a JPEG Blob — the shutter action.
  // Optional `maxDimension` caps the longer edge (the frame is scaled down,
  // never up) and `quality` overrides the JPEG quality; with no options the
  // frame is captured at full resolution and 0.9, exactly as before.
  const capture = useCallback((opts?: { maxDimension?: number; quality?: number }): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return resolve(null);
      const longest = Math.max(video.videoWidth, video.videoHeight);
      const scale = opts?.maxDimension && longest > opts.maxDimension ? opts.maxDimension / longest : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", opts?.quality ?? 0.9);
    });
  }, []);

  // Runs after every commit — including the one where a caller that only
  // mounts <video> once isActive is true (ActivityDetailModal.tsx's Photos
  // tab) actually renders it for the first time. React attaches refs
  // during the commit phase, strictly before effects run, so by the time
  // this runs videoRef.current is guaranteed to be the real element,
  // whether it already existed (CameraCaptureModal.tsx renders <video>
  // unconditionally) or was just mounted this commit.
  useEffect(() => {
    if (isActive && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  });

  useEffect(() => stop, [stop]);

  return { videoRef, isActive, unsupported, error, start, stop, capture };
}
