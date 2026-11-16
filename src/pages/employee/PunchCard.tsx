// Today's In / Out on the Employee Portal. A punch needs two things from the employee's own device, taken at that
// moment: a live camera picture (no uploads) and the device location. Both are sent with the punch; the server
// supplies the time from its own clock.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, LogIn, LogOut, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { getPortalPunchState, portalPunch, type PunchLocation, type PunchState } from "@/api/employeePortalApi";
import BreakPanel from "./BreakPanel";
import { Card, Mark, fmtTime, keyInk, keyLine, labelCls } from "./employeeUi";

const MAX_WIDTH = 640;
const JPEG_QUALITY = 0.72;

const mapsUrl = (l: PunchLocation) => `https://www.google.com/maps?q=${l.lat},${l.lng}`;
const place = (l: PunchLocation | null) =>
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
function CaptureDialog({ kind, onClose, onDone }: { kind: "in" | "out"; onClose: () => void; onDone: () => void }) {
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
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={kind === "in" ? "Punch in" : "Punch out"}>
      <div className="w-full max-w-md bg-card border border-foreground">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-foreground/30">
          <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{kind === "in" ? "Punch In" : "Punch Out"}</h2>
          <button onClick={() => { stop(); onClose(); }} aria-label="Close" className="p-1"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative aspect-[4/3] bg-black overflow-hidden">
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
  );
}

export default function PunchCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-punch"], queryFn: getPortalPunchState, refetchInterval: 60_000 });
  const [dialog, setDialog] = useState<"in" | "out" | null>(null);
  const done = () => { setDialog(null); qc.invalidateQueries({ queryKey: ["ep-punch"] }); qc.invalidateQueries({ queryKey: ["ep-attendance"] }); };
  const cur = data?.current;
  const setState = (s: PunchState) => { qc.setQueryData(["ep-punch"], s); qc.invalidateQueries({ queryKey: ["ep-attendance"] }); };

  return (
    <>
      <Card title="Today" className="mb-6" right={cur ? <Mark text={cur.outTime ? "Present" : data?.state === "ON_BREAK" ? "Half Day" : "Pending"} label={cur.outTime ? "Day complete" : data?.state === "ON_BREAK" ? "On break" : "Working"} /> : undefined}>
        <div className="p-4 flex flex-wrap items-center justify-between gap-4">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : isError ? <p className="text-sm text-destructive">{(error as Error).message}</p> : (
            <>
              <div className="grid sm:grid-cols-2 gap-x-10 gap-y-2 text-sm">
                <div><p className={labelCls}>In time</p><p className="font-heading font-bold text-lg tabular-nums">{cur ? fmtTime(cur.inTime) : "—"}</p><p className="text-xs">{place(cur?.inLocation ?? null)}</p></div>
                <div><p className={labelCls}>Out time</p><p className="font-heading font-bold text-lg tabular-nums">{cur?.outTime ? fmtTime(cur.outTime) : "—"}</p><p className="text-xs">{place(cur?.outLocation ?? null)}</p></div>
              </div>
              <div className="flex gap-2">
                {data?.allowed.in && <button className={keyInk} onClick={() => setDialog("in")}><LogIn size={13} /> Punch in</button>}
                {data?.allowed.out && <button className={keyInk} onClick={() => setDialog("out")}><LogOut size={13} /> Punch out</button>}
                {data?.state === "COMPLETED" && <span className="text-sm text-muted-foreground">Today's attendance is complete.</span>}
                {data?.state === "ON_BREAK" && <span className="text-sm text-muted-foreground">You are on a break — end it before punching out.</span>}
              </div>
            </>
          )}
        </div>
        {data && cur && <BreakPanel state={data} onChange={setState} />}
      </Card>
      {dialog && <CaptureDialog kind={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}
