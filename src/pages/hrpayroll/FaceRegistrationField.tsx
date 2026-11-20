// Employee Master › Face Registration. Usually the employee registers from the Employee Portal app (Profile › Face
// registration) and HR approves it here, comparing the photo with the employee. HR can also register from a webcam, 3–5 photos → the server checks quality, builds an encrypted template (never the photos).
// Also: revoke / re-register, the "face exempt" alternative, and the latest verification results.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ScanFace, Trash2, X } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { HR_LBL, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED } from "@/components/sheet/sheetParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { BodyPortal } from "@/components/ui/body-portal";
import { approveFace, enrollFace, getFaceReviewPhoto, getFaceStatus, rejectFace, revokeFace, setFaceExempt, type FaceTemplateRow } from "@/api/employeeMasterApi";

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const NEED = 3;
const MAX = 5;

/** Webcam capture dialog: consent first, then 3–5 photos, then register. */
function CaptureDialog({ employeeId, name, onClose, onDone }: { employeeId: number; name: string; onClose: () => void; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [consent, setConsent] = useState(false);
  const [cam, setCam] = useState<"off" | "starting" | "ready" | "error">("off");
  const [camErr, setCamErr] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setCam("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
      setCam("ready");
    } catch (e) {
      setCam("error");
      setCamErr((e as DOMException)?.name === "NotAllowedError" ? "Camera access is blocked. Allow the camera for this site, then try again." : "The camera could not be started (it needs https and a webcam).");
    }
  };
  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth || shots.length >= MAX) return;
    const scale = Math.min(1, 800 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    setShots((s) => [...s, c.toDataURL("image/jpeg", 0.85)]);
    setProblems([]);
  };
  const save = async () => {
    setBusy(true); setProblems([]);
    try {
      toast.success((await enrollFace(employeeId, shots)).message);
      stop(); onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      setProblems([msg]); toast.error(msg);
    } finally { setBusy(false); }
  };

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Face registration">
        <div className="w-full max-w-lg max-h-[calc(100vh-1.5rem)] overflow-y-auto bg-card border border-border shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-heading text-sm font-bold">Face registration · {name}</h2>
            <button onClick={() => { stop(); onClose(); }} aria-label="Close" className="p-1"><X size={16} /></button>
          </div>
          <div className="p-4 space-y-3 text-sm">
            {cam === "off" ? (
              <>
                <p>The employee's face will be used <b>only to verify their own attendance punches</b> on the Employee Portal (web and app).</p>
                <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                  <li>Photos are not stored — only an encrypted face template.</li>
                  <li>HR can revoke it at any time; the employee can ask for it to be removed.</li>
                  <li>If the employee can't use face verification, close this and use “Face check exempt” instead.</li>
                </ul>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>The employee is present and has given consent for face registration.</span></label>
                <button className={`${KEY_INK} h-9 px-4`} disabled={!consent} onClick={start}><Camera size={14} /> Start camera</button>
              </>
            ) : (
              <>
                <div className="relative aspect-[4/3] bg-black overflow-hidden">
                  <video ref={video} playsInline muted className="w-full h-full object-cover [transform:scaleX(-1)]" />
                  <div className="pointer-events-none absolute inset-[18%_28%] rounded-[50%] border-2 border-white/70" />
                  {cam !== "ready" && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-white">{cam === "starting" ? "Starting camera…" : camErr}</div>}
                </div>
                <p className="text-xs text-muted-foreground">Face inside the oval, straight at the camera, good light, nobody else in the frame. Take {NEED}–{MAX} photos, turning the head very slightly between them.</p>
                <div className="flex flex-wrap gap-2">
                  {shots.map((s, i) => (
                    <div key={i} className="relative">
                      <img src={s} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover border border-border [transform:scaleX(-1)]" />
                      <button className="absolute -top-1.5 -right-1.5 bg-card border border-border rounded-full p-0.5" aria-label="Remove" onClick={() => setShots((x) => x.filter((_, j) => j !== i))}><X size={10} /></button>
                    </div>
                  ))}
                </div>
                {problems.map((p) => <p key={p} className="text-xs text-destructive">{p}</p>)}
                <div className="flex flex-wrap gap-2">
                  <button className={`${KEY_LINE} h-9 px-4`} disabled={cam !== "ready" || shots.length >= MAX || busy} onClick={snap}><Camera size={14} /> Take photo ({shots.length}/{MAX})</button>
                  <button className={`${KEY_INK} h-9 px-4`} disabled={shots.length < NEED || busy} onClick={save}><ScanFace size={14} /> {busy ? "Checking…" : "Register face"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

/** A small form for the reason HR must give (reject / revoke / exempt), in the page's own style. */
type Ask = { title: string; note: string; label: string; confirm: string; tone: "ink" | "red"; presets?: string[]; onSubmit: (reason: string) => void };
function ReasonDialog({ ask, busy, onClose }: { ask: Ask; busy: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const ok = text.trim().length >= 3;
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={ask.title}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <form className="w-full max-w-md bg-card border border-foreground shadow-2xl" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (ok && !busy) ask.onSubmit(text.trim()); }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-heading text-sm font-bold uppercase tracking-[0.08em]">{ask.title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1"><X size={16} /></button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">{ask.note}</p>
            {ask.presets && (
              <div className="flex flex-wrap gap-1.5">
                {ask.presets.map((p) => (
                  <button key={p} type="button" onClick={() => setText(p)}
                    className={`border px-2 py-1 text-xs ${text === p ? "border-foreground bg-foreground text-card" : "border-border hover:border-foreground"}`}>{p}</button>
                ))}
              </div>
            )}
            <label className="block">
              <span className={HR_LBL}>{ask.label} <span className="text-destructive">*</span></span>
              <textarea autoFocus rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)}
                className="mt-1 w-full border border-border bg-background px-2 py-1.5 text-sm focus:border-foreground outline-none" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${KEY_LINE} h-9 px-4`} onClick={onClose}>Cancel</button>
              <button type="submit" className={`${ask.tone === "red" ? KEY_RED : KEY_INK} h-9 px-4`} disabled={!ok || busy}>{busy ? "Saving…" : ask.confirm}</button>
            </div>
          </div>
        </form>
      </div>
    </BodyPortal>
  );
}

/** A self-registration waiting for HR: the photo the employee took, the match with the profile photo, approve / reject. */
function PendingReview({ employeeId, p, canEdit, onDone }: { employeeId: number; p: FaceTemplateRow; canEdit: boolean; onDone: () => void }) {
  const photo = useQuery({ queryKey: ["employee-face-review", employeeId, p.FaceTemplateId], queryFn: () => getFaceReviewPhoto(employeeId, p.FaceTemplateId), enabled: !!p.HasReviewPhoto });
  const approve = useMutation({ mutationFn: () => approveFace(employeeId, p.FaceTemplateId), onSuccess: (r) => { toast.success(r.message); onDone(); }, onError: (e: Error) => toast.error(e.message) });
  const reject = useMutation({ mutationFn: (reason: string) => rejectFace(employeeId, p.FaceTemplateId, reason), onSuccess: (r) => { toast.success(r.message); onDone(); }, onError: (e: Error) => toast.error(e.message) });
  const score = p.ProfileScore != null ? Number(p.ProfileScore) : null;
  const [asking, setAsking] = useState(false);
  return (
    <div className="border border-amber-500/60 bg-amber-500/10 p-3 flex flex-wrap gap-4 items-start">
      {photo.data?.photo ? <img src={photo.data.photo} alt="Submitted face" className="h-28 w-28 object-cover border border-border" /> : <div className="h-28 w-28 border border-border flex items-center justify-center text-xs text-muted-foreground">{photo.isLoading ? "Loading…" : "No photo"}</div>}
      <div className="flex-1 min-w-[14rem] space-y-1 text-sm">
        <p className="font-semibold">Face registration waiting for your approval</p>
        <p className="text-xs text-muted-foreground">Sent from the Employee Portal app on {fmt(p.EnrolledAt)} · {p.SampleCount} photos passed the quality checks.</p>
        <p className="text-xs">{score == null ? "No profile photo to compare with — check the photo against the employee yourself."
          : <>Match with the profile photo: <b className={score >= 0.4 ? "text-emerald-600" : "text-destructive"}>{score.toFixed(2)}</b> {score >= 0.4 ? "(looks like the same person)" : "(does NOT look like the profile photo — check carefully)"}</>}</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={`${KEY_INK} h-9 px-4`} disabled={approve.isPending} onClick={() => approve.mutate()}><ScanFace size={14} /> Approve</button>
            <button type="button" className={`${KEY_RED} h-9 px-4`} disabled={reject.isPending} onClick={() => setAsking(true)}><X size={14} /> Reject</button>
          </div>
        )}
      </div>
      {asking && (
        <ReasonDialog busy={reject.isPending} onClose={() => setAsking(false)} ask={{
          title: "Reject face registration", tone: "red", confirm: "Reject", label: "Reason (shown to the employee)",
          note: "The employee sees this reason in the app and can register again.",
          presets: ["Photo is not of this employee", "Face not clear — retake in good light", "Someone else is in the photo", "Mask or dark glasses"],
          onSubmit: (r) => reject.mutate(r, { onSuccess: () => setAsking(false) }),
        }} />
      )}
    </div>
  );
}

export const FaceRegistrationField: React.FC<{ employeeId: number | null; name?: string }> = ({ employeeId, name }) => {
  const rights = usePageRights("employee-master");
  const qc = useQueryClient();
  const [capture, setCapture] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["employee-face", employeeId], queryFn: () => getFaceStatus(employeeId!), enabled: employeeId != null });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["employee-face", employeeId] }); qc.invalidateQueries({ queryKey: ["employee-master"] }); };
  const revoke = useMutation({ mutationFn: (reason: string) => revokeFace(employeeId!, reason), onSuccess: (r) => { toast.success(r.message); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const exempt = useMutation({ mutationFn: (v: { on: boolean; reason: string }) => setFaceExempt(employeeId!, v.on, v.reason), onSuccess: (r) => { toast.success(r.message); refresh(); }, onError: (e: Error) => toast.error(e.message) });

  const box = "bg-card p-4";
  if (employeeId == null) return <p className={`${box} text-sm text-muted-foreground`} style={{ border: HR_RULE }}>Save the employee first, then register their face here.</p>;
  if (isLoading) return <p className={`${box} text-sm text-muted-foreground`} style={{ border: HR_RULE }}>Loading…</p>;
  if (error || !data) return <p className={`${box} text-sm text-destructive`} style={{ border: HR_RULE }}>{(error as Error)?.message || "Could not load face registration."}</p>;

  const a = data.active;
  const askRevoke = () => setAsk({
    title: "Revoke face registration", tone: "red", confirm: "Revoke", label: "Reason",
    note: "The face is removed. The employee can't punch until they register again (from the app) and HR approves it.",
    presets: ["Employee asked to remove it", "Wrong person registered", "Face changed — register again", "Left the company"],
    onSubmit: (r) => revoke.mutate(r, { onSuccess: () => setAsk(null) }),
  });
  const askExempt = () => {
    if (data.exempt) { exempt.mutate({ on: false, reason: "" }); return; }
    setAsk({
      title: "Face check exempt", tone: "ink", confirm: "Exempt from face check", label: "Why can't this employee use face verification?",
      note: "Their punches skip the face check but still need their work location, and every punch is flagged for HR review.",
      presets: ["Injury / medical reason", "Face does not match repeatedly", "No smartphone with a front camera", "Temporary — until re-registration"],
      onSubmit: (r) => exempt.mutate({ on: true, reason: r }, { onSuccess: () => setAsk(null) }),
    });
  };
  return (
    <div className={`${box} space-y-4`} style={{ border: HR_RULE }}>
      {!data.configured && <p className="text-xs text-destructive">Face verification is not configured on the server (FACE_TEMPLATE_KEY). Registration is unavailable.</p>}
      {data.pending && <PendingReview employeeId={employeeId} p={data.pending} canEdit={rights.canEdit} onDone={refresh} />}
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <p className={HR_LBL}>Face registration</p>
          <div className="mt-1"><SheetMark text={a ? "Active" : data.pending ? "Waiting for approval" : "Not registered"} tone={a ? "done" : "waiting"} /></div>
          {a && <p className="text-xs text-muted-foreground mt-1">{fmt(a.EnrolledAt)} · {a.Source === "Self" ? `self-registered, approved by ${a.DecidedByName ?? "HR"}` : a.EnrolledByName ?? ""} · {a.SampleCount} photos</p>}
        </div>
        <div>
          <p className={HR_LBL}>Face check</p>
          <div className="mt-1"><SheetMark text={data.exempt ? "Exempt" : data.faceRequired ? "Required" : "Off"} tone={data.exempt ? "stopped" : "done"} /></div>
          {data.exempt && data.exemptReason && <p className="text-xs text-muted-foreground mt-1">{data.exemptReason}</p>}
        </div>
        <div>
          <p className={HR_LBL}>Allowed work locations</p>
          <p className="text-sm mt-1">{data.locations.length ? data.locations.map((l) => `${l.LocationName} (${l.RadiusMeters} m)`).join(", ") : <span className="text-destructive">None — assign one on the Basic Information tab, or punches are refused</span>}</p>
        </div>
      </div>
      {rights.canEdit && (
        <div className="flex flex-wrap gap-3 pt-1">
          <button type="button" className={`${KEY_INK} h-9 px-4`} disabled={!data.configured} onClick={() => setCapture(true)}><ScanFace size={14} /> {a ? "Re-register with webcam" : "Register with webcam"}</button>
          {a && <button type="button" className={`${KEY_RED} h-9 px-4`} onClick={askRevoke} disabled={revoke.isPending}><Trash2 size={14} /> Revoke</button>}
          <button type="button" className={`${KEY_LINE} h-9 px-4`} onClick={askExempt} disabled={exempt.isPending}>{data.exempt ? "Require face check again" : "Face check exempt"}</button>
        </div>
      )}
      {data.recent.length > 0 && (
        <div>
          <p className={HR_LBL}>Latest checks</p>
          <div className="mt-1 overflow-x-auto"><table className="w-full text-xs">
            <tbody className="divide-y divide-border">
              {data.recent.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 whitespace-nowrap">{fmt(r.CreatedAt)}</td>
                  <td className="py-1 pr-2 uppercase">{r.Purpose}</td>
                  <td className={`py-1 pr-2 font-semibold ${r.Result === "Pass" ? "text-emerald-600" : r.Result === "Exempt" ? "text-amber-600" : "text-destructive"}`}>{r.Result}</td>
                  <td className="py-1 pr-2">{r.Score != null ? `score ${Number(r.Score).toFixed(2)}` : ""}{r.LocationName ? ` · ${r.LocationName} ${r.DistanceM ?? ""} m` : ""}</td>
                  <td className="py-1 text-muted-foreground">{r.Reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {data.history.length > 1 && (
        <p className="text-xs text-muted-foreground">History: {data.history.map((h) => `${h.Status} ${fmt(h.EnrolledAt)}${h.RevokeReason ? ` (${h.RevokeReason})` : ""}`).join(" · ")}</p>
      )}
      {ask && <ReasonDialog ask={ask} busy={revoke.isPending || exempt.isPending} onClose={() => setAsk(null)} />}
      {capture && <CaptureDialog employeeId={employeeId} name={name ?? "Employee"} onClose={() => setCapture(false)} onDone={() => { setCapture(false); refresh(); }} />}
    </div>
  );
};
