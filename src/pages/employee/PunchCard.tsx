// Today's In / Out on the Employee Portal. A punch needs two things from the employee's own device, taken at that
// moment: a live camera picture (no uploads) and the device location. Both are sent with the punch; the server
// supplies the time from its own clock.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Clock, LogIn, LogOut, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { getPortalPunchState, portalPunch, type PunchLocation, type PunchState } from "@/api/employeePortalApi";
import BreakPanel from "./BreakPanel";
import { BodyPortal } from "@/components/ui/body-portal";
import { fmtTime, isViewOnly, keyInk, keyLine, labelCls } from "./employeeUi";

const MAX_WIDTH = 640;
const JPEG_QUALITY = 0.72;

const mapsUrl = (l: PunchLocation) => `https://www.google.com/maps?q=${l.lat},${l.lng}`;
export const place = (l: PunchLocation | null) =>
  l ? (
    <a href={mapsUrl(l)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
      <MapPin size={12} /> {l.lat.toFixed(5)}, {l.lng.toFixed(5)}{l.accuracyM != null ? ` (±${l.accuracyM} m)` : ""}
    </a>
  ) : null;

const geoMessage = (e: GeolocationPositionError) =>
  e.code === e.PERMISSION_DENIED ? "Location access is blocked. Allow location for this site in your browser, then try again."
  : e.code === e.TIMEOUT ? "Could not get your location in time. Move to an open area and try again."
  : "Your device could not find its location. Turn on location services and try again.";

const getPosition = () =>
  new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device or browser can't share its location."));
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(geoMessage(e))), { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });

// ── The capture dialog: live camera preview + location, then "Capture & punch" ──
export function CaptureDialog({ kind, onClose, onDone }: { kind: "in" | "out"; onClose: () => void; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"starting" | "ready" | "error">("starting");
  const [cameraError, setCameraError] = useState("");
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [locError, setLocError] = useState("");
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; }, []);

  const startLocation = useCallback(() => {
    setLocError("");
    setPosition(null);
    getPosition().then(setPosition).catch((e: Error) => setLocError(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("error");
        setCameraError("The camera needs a secure (https) connection and a supported browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
        setCamera("ready");
      } catch (e) {
        setCamera("error");
        const name = (e as DOMException)?.name;
        setCameraError(name === "NotAllowedError" ? "Camera access is blocked. Allow the camera for this site in your browser, then try again."
          : name === "NotFoundError" ? "No camera was found on this device." : "The camera could not be started.");
      }
    })();
    startLocation();
    return () => { cancelled = true; stop(); };
  }, [startLocation, stop]);

  const punch = async () => {
    const video = videoRef.current;
    if (!video || !position || video.videoWidth === 0) return;
    setBusy(true);
    try {
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      await portalPunch(kind, { photo, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null });
      toast.success(kind === "in" ? "In time recorded" : "Out time recorded");
      stop();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the punch");
    } finally {
      setBusy(false);
    }
  };

  const ready = camera === "ready" && !!position && !busy;
  return (
    <BodyPortal>
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={kind === "in" ? "Punch in" : "Punch out"}>
      <div className="w-full max-w-md max-h-[calc(100vh-1.5rem)] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-heading text-sm font-bold">{kind === "in" ? "Punch In" : "Punch Out"}</h2>
          <button onClick={() => { stop(); onClose(); }} aria-label="Close" className="p-1"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative aspect-[4/3] bg-black overflow-hidden rounded-xl">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover [transform:scaleX(-1)]" />
            {camera !== "ready" && (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">
                {camera === "starting" ? "Starting camera…" : cameraError}
              </div>
            )}
          </div>
          <div className="text-sm flex items-start gap-2">
            <MapPin size={14} className="mt-0.5 shrink-0" />
            {position ? <span>Location found (±{Math.round(position.coords.accuracy)} m)</span>
              : locError ? <span className="text-destructive">{locError} <button className="underline" onClick={startLocation}>Retry</button></span>
              : <span className="text-muted-foreground">Getting your location…</span>}
          </div>
          <p className="text-xs text-muted-foreground">Look at the camera. The picture is taken live from your device and saved with your location and the server time.</p>
          <div className="flex justify-end gap-2">
            <button className={keyLine} onClick={() => { stop(); onClose(); }}>Cancel</button>
            <button className={keyInk} disabled={!ready} onClick={punch}><Camera size={13} /> {busy ? "Saving…" : kind === "in" ? "Capture & punch in" : "Capture & punch out"}</button>
          </div>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}

export default function PunchCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-punch"], queryFn: getPortalPunchState, refetchInterval: 60_000 });
  const [dialog, setDialog] = useState<"in" | "out" | null>(null);
  const done = () => { setDialog(null); qc.invalidateQueries({ queryKey: ["ep-punch"] }); qc.invalidateQueries({ queryKey: ["ep-attendance"] }); };
  const cur = data?.current;
  const setState = (s: PunchState) => { qc.setQueryData(["ep-punch"], s); qc.invalidateQueries({ queryKey: ["ep-attendance"] }); };

  const statusLabel = cur ? (cur.outTime ? "Day complete" : data?.state === "ON_BREAK" ? "On break" : "Working") : "Not in yet";

  return (
    <>
      <section className="ep-tile ep-gold overflow-hidden mb-4" aria-label="Today's attendance">
        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Clock size={20} /></span>
              <div><p className="font-heading font-bold text-base leading-tight">Today</p><p className="text-xs text-white/80">Punch in and out with photo and location</p></div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-white/20 text-[0.625rem] font-bold uppercase tracking-[0.08em] whitespace-nowrap shrink-0">{statusLabel}</span>
          </div>
          {isLoading ? <p className="text-sm text-white/80 mt-4">Loading…</p> : isError ? <p className="text-sm mt-4">{(error as Error).message}</p> : (
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                <div><p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-white/75">In time</p><p className="font-heading font-bold text-2xl tabular-nums">{cur ? fmtTime(cur.inTime) : "—"}</p><p className="text-xs text-white/85">{place(cur?.inLocation ?? null)}</p></div>
                <div><p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-white/75">Out time</p><p className="font-heading font-bold text-2xl tabular-nums">{cur?.outTime ? fmtTime(cur.outTime) : "—"}</p><p className="text-xs text-white/85">{place(cur?.outLocation ?? null)}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data?.allowed.in && <button className="ep-btn ep-btn-light" disabled={isViewOnly()} onClick={() => setDialog("in")}><LogIn size={14} /> Punch in</button>}
                {data?.allowed.out && <button className="ep-btn ep-btn-light" disabled={isViewOnly()} onClick={() => setDialog("out")}><LogOut size={14} /> Punch out</button>}
                {data?.state === "COMPLETED" && <span className="text-sm text-white/90">Today's attendance is complete.</span>}
                {data?.state === "ON_BREAK" && <span className="text-sm text-white/90">You are on a break — end it before punching out.</span>}
              </div>
            </div>
          )}
        </div>
        {data && <div className="bg-card text-card-foreground"><BreakPanel state={data} onChange={setState} /></div>}
      </section>
      {dialog && <CaptureDialog kind={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}
