import { useCallback, useEffect, useRef, useState } from "react";

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

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsActive(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setUnsupported(true);
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsActive(true);
      return true;
    } catch {
      // Permission denied, no camera, or insecure context — caller falls
      // back to a plain file input (still hinting capture="environment").
      setUnsupported(true);
      return false;
    }
  }, []);

  // Draws the current video frame to an offscreen canvas and encodes it as
  // a JPEG Blob — the shutter action.
  const capture = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
    });
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, isActive, unsupported, start, stop, capture };
}
