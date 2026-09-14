import React from "react";
import { createPortal } from "react-dom";
import { Camera as CameraIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useCameraCapture } from "@/hooks/useCameraCapture";

// Live device-camera capture in a modal. Draws the shutter frame to a canvas,
// downscales it to `maxDim` on the long edge and encodes JPEG at `quality`,
// then hands back a data URL — kept small enough for the ~400 KB image
// columns the FA modules store (UserImage, ItemPicture, …).
async function frameToDataUrl(blob: Blob, maxDim: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export function CameraCaptureModal({
  onCapture,
  onClose,
  maxDim = 1024,
  quality = 0.75,
}: {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  maxDim?: number;
  quality?: number;
}) {
  const cam = useCameraCapture();
  const [starting, setStarting] = React.useState(true);
  const [shooting, setShooting] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    cam.start().then((ok) => {
      if (alive) {
        setStarting(false);
        if (!ok) toast.error("Camera unavailable on this device");
      }
    });
    return () => cam.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shutter = async () => {
    setShooting(true);
    try {
      const blob = await cam.capture();
      if (!blob) {
        setShooting(false);
        toast.error("Could not capture — try again");
        return;
      }
      const dataUrl = await frameToDataUrl(blob, maxDim, quality);
      cam.stop();
      onCapture(dataUrl);
      onClose();
    } catch {
      setShooting(false);
      toast.error("Could not process the photo — try again");
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={() => { cam.stop(); onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden bg-black border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-black min-h-[240px] flex items-center justify-center">
          {(starting || cam.unsupported) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 text-xs">
              {cam.unsupported ? (
                <><CameraIcon size={22} /> Camera not available</>
              ) : (
                <><Loader2 size={20} className="animate-spin" /> Starting camera…</>
              )}
            </div>
          )}
          <video ref={cam.videoRef} playsInline muted className="w-full max-h-[60vh] object-contain" />
          <button
            type="button"
            onClick={() => { cam.stop(); onClose(); }}
            className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex items-center justify-center p-4 bg-black">
          <button
            type="button"
            onClick={shutter}
            disabled={!cam.isActive || shooting}
            className="w-16 h-16 rounded-full bg-white border-4 border-white/40 hover:border-white/70 transition-colors disabled:opacity-40 flex items-center justify-center"
          >
            {shooting ? <Loader2 size={20} className="animate-spin text-black" /> : <CameraIcon size={22} className="text-black" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
