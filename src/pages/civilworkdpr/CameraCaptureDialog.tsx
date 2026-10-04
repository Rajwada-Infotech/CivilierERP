import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Webcam from "react-webcam";
import { Camera, Check, Loader2, RefreshCw, SwitchCamera, X } from "lucide-react";

/**
 * Live-camera capture: shows the device camera, takes a still, lets the user
 * retake or confirm, and hands the confirmed photo back as a JPEG Blob.
 * Rendered in a portal above everything (it is opened from inside another modal).
 */
export function CameraCaptureDialog({
  open,
  title = "Take photo",
  saving = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  /** True while the caller is uploading the confirmed photo. */
  saving?: boolean;
  onCancel: () => void;
  onConfirm: (photo: Blob) => void;
}) {
  const webcamRef = useRef<Webcam>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(() => {
    const data = webcamRef.current?.getScreenshot();
    if (data) setShot(data);
  }, []);

  const confirm = async () => {
    if (!shot) return;
    const blob = await (await fetch(shot)).blob();
    onConfirm(blob);
  };

  const close = () => {
    setShot(null);
    setError(null);
    onCancel();
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label={title}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
            <Camera size={14} className="text-cyan-600 dark:text-cyan-400" /> {title}
          </span>
          <button type="button" onClick={close} disabled={saving} className="p-1 rounded-md text-muted-foreground hover:bg-muted" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="bg-black">
          {shot ? (
            <img src={shot} alt="Captured" className="w-full" />
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-300">{error}</div>
          ) : (
            <div className="relative">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                screenshotQuality={0.85}
                className="w-full"
                mirrored={facing === "user"}
                videoConstraints={{ width: 1280, height: 720, facingMode: { ideal: facing } }}
                onUserMediaError={(e) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  setError(msg.toLowerCase().includes("permission") ? "Camera permission denied." : `Could not access the camera: ${msg}`);
                }}
              />
              <button
                type="button"
                onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                title="Switch camera"
                className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/70"
              >
                <SwitchCamera size={16} />
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-4 py-3 border-t border-border">
          {shot ? (
            <>
              <button
                type="button"
                onClick={() => setShot(null)}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw size={14} /> Retake
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? "Saving…" : "Use photo"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={capture}
              disabled={!!error}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              <Camera size={14} /> Capture
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
