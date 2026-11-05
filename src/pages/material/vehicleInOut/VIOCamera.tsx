import Webcam from "react-webcam";
import { Button } from "@/components/ui/button";
import { XCircle, Camera, RefreshCw, CheckCircle2, SwitchCamera, Image as ImageIcon } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import type { VIOState } from "./useVehicleInOut";

// Taking a photo with the device camera.
export function VIOCamera({ m }: { m: VIOState }) {
  const { uploading, showCamera, setShowCamera, cameraError, setCameraError, facingMode, webcamRef, capturingPoItemId, setCapturingPoItemId, form, poItemsRemaining, capturePhoto, switchCamera } = m;
  return (
    <>
      {/* ── Camera capture modal ── */}
      {showCamera && (
        <BodyPortal><div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-card border border-foreground/30 w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/30">
              <div className="flex items-center gap-2">
                <Camera size={15} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  {capturingPoItemId != null
                    ? `Capture Photo — ${poItemsRemaining.find((p) => p.poItemId === capturingPoItemId)?.itemName || "Item"}`
                    : "Capture Vehicle / Plate Photo"}
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setShowCamera(false);
                  setCapturingPoItemId(null);
                }}
              >
                <XCircle size={15} />
              </Button>
            </div>

            <div className="p-4">
              {cameraError ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                  <XCircle size={32} className="text-destructive" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <p className="text-xs text-muted-foreground/60">
                    Please allow camera access in your browser settings and try
                    again.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    className="w-full"
                    width={640}
                    height={480}
                    mirrored={facingMode === "user"}
                    videoConstraints={{
                      width: 640,
                      height: 480,
                      facingMode: { ideal: facingMode },
                    }}
                    onUserMediaError={(err) => {
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      setCameraError(
                        msg.toLowerCase().includes("permission")
                          ? "Camera permission denied."
                          : "Could not access camera: " + msg,
                      );
                    }}
                  />

                  {/* Switch camera (front/back) */}
                  <button
                    type="button"
                    onClick={switchCamera}
                    title="Switch camera"
                    className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 bg-black/55 text-white hover:bg-black/70 transition-colors"
                  >
                    <SwitchCamera size={16} />
                  </button>

                  {/* Multi-capture hint */}
                  {capturingPoItemId == null && form.attachments.length > 0 && (
                    <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-black/55 text-white text-[0.6875rem]">
                      <ImageIcon size={11} />
                      {form.attachments.length} attached
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-foreground/30">
              <Button
                className="flex-1 gap-2 rounded-none bg-foreground text-card border border-foreground hover:bg-foreground/90"
                onClick={capturePhoto}
                disabled={!!cameraError || uploading}
              >
                {uploading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {uploading ? "Saving…" : "Capture"}
              </Button>
              {form.attachments.length > 0 && capturingPoItemId == null && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCamera(false)}
                >
                  Done
                </Button>
              )}
            </div>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
}
