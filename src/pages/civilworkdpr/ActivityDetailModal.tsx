import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  X,
  Loader2,
  Camera as CameraIcon,
  ImageOff,
  Trash2,
  MapPin,
  Clock,
  CheckCircle2,
  Activity as ActivityIcon,
  ScanLine,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Upload,
  Package,
  UserRound,
  CalendarDays,
  RotateCcw,
  Users2,
  Plus,
  Save,
  UserX,
  ListChecks,
  Check,
  Timer,
  TrendingUp,
  History,
  ShieldQuestion,
  Lock,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import {
  getActivityPhotos,
  getActivityPhoto,
  uploadActivityPhoto,
  deleteActivityPhoto,
  getBlueprintAnnotation,
  getBlueprintAnnotationHistory,
  updateAssignmentDetail,
  getRungAssignment,
  saveRungAssignment,
  getAssignmentAttempts,
  restoreCancelledActivity,
  getProgressLog,
  getDailyLog,
  startDelayInfo,
  ASSIGNMENT_STATUS_META,
  type PhotoPhase,
  type ActivityPhotoMeta,
  type ReportedAssignment,
  type AssignmentCheckpoint,
  type AssignmentStatus,
  type DailyLogEntry,
} from "@/api/dependencyActivityAssignmentApi";
import { CheckpointDailyUpdates } from "./CheckpointDailyUpdates";
import {
  getAttendance,
  saveAttendance,
  removeFromRoster,
  type AttendanceStatus,
} from "@/api/workerAttendanceApi";
import { AddWorkerDialog, inputCls, STATUS_LABEL, STATUS_CLS, todayIso } from "@/pages/civilworkdpr/WorkerAttendance";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import { QcBadge, AttemptBadge } from "@/components/civilworkdpr/QcBadge";
import { useOverlayBackClose } from "@/hooks/useOverlayBackClose";
import { useCameraCapture, CAMERA_ERROR_TEXT } from "@/hooks/useCameraCapture";
import { useAuth } from "@/contexts/AuthContext";
import { DateInput } from "@/components/ui/date-input";

type DetailTab = "overview" | "blueprint" | "photos" | "attendance" | "checkpoints" | "daily-log" | "history";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDays(startStr: string, endStr: string): number | null {
  const s = new Date(`${startStr}T00:00:00`);
  const e = new Date(`${endStr}T00:00:00`);
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

const TAG_META: Record<PhotoPhase, { label: string; icon: LucideIcon; color: string }> = {
  before: { label: "Before", icon: Clock, color: "#f59e0b" },
  after: { label: "After", icon: CheckCircle2, color: "#22c55e" },
};
const TAG_ORDER: PhotoPhase[] = ["before", "after"];

// Shared between the carry-forward upload call and PhotoThumb's badge check
// below — a Before photo tagged with exactly this note is one the system
// cloned automatically from the previous After, not one the field engineer
// actually took, and the gallery should say so visibly rather than only in
// the lightbox's fine print.
const CARRIED_FORWARD_NOTE = "Carried forward from previous After";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Best-effort — geolocation is a nice-to-have on a photo, never a blocker
// for the capture itself. Callers get "" on denial/timeout/unsupported.
function getGeoTag(): Promise<string> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve("");
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`),
      () => resolve(""),
      { timeout: 4000, maximumAge: 60_000 },
    );
  });
}

// ── Photos tab ───────────────────────────────────────────────────────────

function PhotoThumb({
  rungId,
  photo,
  onOpen,
  onDeleted,
}: {
  rungId: number;
  photo: ActivityPhotoMeta;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["activity-photo", rungId, photo.id],
    queryFn: () => getActivityPhoto(rungId, photo.id),
    staleTime: 5 * 60_000,
  });
  const [deleting, setDeleting] = useState(false);
  const carriedForward = photo.phase === "before" && photo.note === CARRIED_FORWARD_NOTE;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this photo?")) return;
    setDeleting(true);
    try {
      await deleteActivityPhoto(rungId, photo.id);
      onDeleted();
    } catch (err: any) {
      toast.error(err.message || "Could not delete photo");
      setDeleting(false);
    }
  };

  return (
    <div className="relative group w-20 h-20 shrink-0">
      <button
        type="button"
        onClick={onOpen}
        title={photo.fileName}
        className="w-full h-full rounded-lg border border-border overflow-hidden bg-muted/30 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-foreground/30 transition-all"
      >
        {data ? (
          <img src={`data:${data.mimeType};base64,${data.dataBase64}`} alt={photo.fileName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          </div>
        )}
      </button>
      {carriedForward && (
        <div
          title={CARRIED_FORWARD_NOTE}
          className="absolute bottom-1 left-1 w-4 h-4 rounded-full bg-black/70 text-amber-400 flex items-center justify-center"
        >
          <RotateCcw size={9} />
        </div>
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        title="Delete photo"
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
      >
        {deleting ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
      </button>
    </div>
  );
}

function PhotoLightbox({ rungId, photo, onClose }: { rungId: number; photo: ActivityPhotoMeta; onClose: () => void }) {
  useOverlayBackClose(onClose);
  const { data, isLoading } = useQuery({
    queryKey: ["activity-photo", rungId, photo.id],
    queryFn: () => getActivityPhoto(rungId, photo.id),
    staleTime: 5 * 60_000,
  });
  const meta = TAG_META[photo.phase];
  const Icon = meta.icon;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-6" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
        <X size={18} />
      </button>
      <div className="max-w-4xl max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {isLoading || !data ? (
          <div className="w-[60vw] max-w-md aspect-video flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-white/60" />
          </div>
        ) : (
          <img src={`data:${data.mimeType};base64,${data.dataBase64}`} alt={photo.fileName} className="max-w-full max-h-[75vh] rounded-xl shadow-2xl object-contain" />
        )}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/70">
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: meta.color }}>
            <Icon size={12} /> {meta.label}
          </span>
          <span>{fmtDateTime(photo.capturedAt)}</span>
          {photo.capturedBy && <span>· {photo.capturedBy}</span>}
          {photo.note && (
            <span className="flex items-center gap-1">
              <MapPin size={11} /> {photo.note}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PhotosTab({ rungId }: { rungId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["activity-photos", rungId],
    queryFn: () => getActivityPhotos(rungId),
  });
  const [activeTag, setActiveTag] = useState<PhotoPhase>("after");
  const [lightboxPhoto, setLightboxPhoto] = useState<ActivityPhotoMeta | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const camera = useCameraCapture();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["activity-photos", rungId] });

  // A new "After" shot marks one work cycle done — the field engineer
  // shouldn't have to separately re-photograph "Before" for the next
  // cycle when it's just whatever the site looked like a moment ago,
  // i.e. the After that was just superseded. So the moment there's an
  // After newer than the current Before, clone that After into Before
  // automatically. Guarded by comparing timestamps (not just "any before
  // exists") so this stays idempotent — safe to call on every load, not
  // just right before a new capture.
  const carryForwardBeforeIfNeeded = async () => {
    try {
      const current = await getActivityPhotos(rungId);
      const lastAfter = current.after[0]; // ORDER BY CapturedAt DESC
      if (!lastAfter) return;
      const lastBefore = current.before[0];
      const alreadyCarried = lastBefore && lastBefore.capturedAt >= lastAfter.capturedAt;
      if (alreadyCarried) return;
      const raw = await getActivityPhoto(rungId, lastAfter.id);
      const blob = await (await fetch(`data:${raw.mimeType};base64,${raw.dataBase64}`)).blob();
      const file = new File([blob], `before-carried-${Date.now()}.jpg`, { type: raw.mimeType });
      await uploadActivityPhoto(rungId, "before", file, CARRIED_FORWARD_NOTE);
      refresh();
    } catch {
      // Best-effort — a failed carry-forward should never block the new capture.
    }
  };

  // Reconciles on every load too, not just right before a new capture —
  // otherwise a Before that should already reflect yesterday's After only
  // ever shows up the next time someone happens to take a new After photo,
  // which could be days later. Keyed on the latest After's own id so this
  // re-checks whenever a new After actually lands, not on every re-render.
  useEffect(() => {
    if (data?.after?.[0]) carryForwardBeforeIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.after?.[0]?.id]);

  const addPhoto = async (blob: Blob) => {
    setUploading(true);
    try {
      await carryForwardBeforeIfNeeded();
      const note = await getGeoTag();
      const file = new File([blob], `${activeTag}-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      await uploadActivityPhoto(rungId, activeTag, file, note || undefined);
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleShutter = async () => {
    const blob = await camera.capture();
    if (blob) await addPhoto(blob);
  };

  const handleFilePicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await carryForwardBeforeIfNeeded();
    for (const file of Array.from(files)) {
      setUploading(true);
      try {
        const note = await getGeoTag();
        await uploadActivityPhoto(rungId, activeTag, file, note || undefined);
      } catch (err: any) {
        toast.error(err.message || "Upload failed");
      } finally {
        setUploading(false);
      }
    }
    refresh();
  };

  const openCamera = async () => {
    const ok = await camera.start();
    if (!ok) {
      // Used to fall straight to the file picker with zero explanation —
      // looked exactly like "the camera doesn't work" with no way to tell
      // permission-denied from no-device from a plain HTTP (non-secure)
      // deployment, which getUserMedia refuses outright.
      toast.error(CAMERA_ERROR_TEXT[camera.error ?? "other"]);
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tag picker — applies to whatever gets captured next. */}
      <div className="flex items-center gap-1.5">
        {TAG_ORDER.map((tag) => {
          const meta = TAG_META[tag];
          const Icon = meta.icon;
          const active = activeTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-[0.6875rem] font-medium border transition-colors"
              style={
                active
                  ? { background: `${meta.color}1A`, borderColor: `${meta.color}60`, color: meta.color }
                  : { borderColor: "var(--border)", color: "var(--muted-foreground)" }
              }
            >
              <Icon size={11} /> {meta.label}
            </button>
          );
        })}
      </div>

      {/* Camera panel */}
      <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
        {camera.isActive ? (
          <div className="relative bg-black">
            <video ref={camera.videoRef} playsInline muted className="w-full max-h-72 object-contain" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 p-3 bg-gradient-to-t from-black/70 to-transparent">
              <button
                type="button"
                onClick={handleShutter}
                disabled={uploading}
                className="w-14 h-14 rounded-full bg-white border-4 border-white/40 hover:border-white/70 transition-colors disabled:opacity-50 flex items-center justify-center"
                title="Capture"
              >
                {uploading && <Loader2 size={18} className="animate-spin text-black" />}
              </button>
              <button type="button" onClick={camera.stop} className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <button
              type="button"
              onClick={openCamera}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold text-white transition-colors"
              style={{ background: TAG_META[activeTag].color }}
            >
              <CameraIcon size={13} /> Open camera
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-border text-foreground bg-background hover:bg-muted transition-colors"
            >
              <Upload size={13} /> Upload instead
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFilePicked(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Gallery, grouped by tag */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TAG_ORDER.map((tag) => {
            const meta = TAG_META[tag];
            const Icon = meta.icon;
            const photos = data?.[tag] ?? [];
            const carriedCount = photos.filter((p) => p.note === CARRIED_FORWARD_NOTE).length;
            return (
              <div key={tag} className="pl-3 border-l-2" style={{ borderColor: `${meta.color}45` }}>
                <p className="flex items-center gap-1 text-[0.625rem] font-heading font-semibold uppercase tracking-wide mb-2" style={{ color: meta.color }}>
                  <Icon size={10} /> {meta.label} · {photos.length}
                  {carriedCount > 0 && (
                    <span className="normal-case font-normal text-muted-foreground flex items-center gap-0.5 ml-0.5">
                      (<RotateCcw size={9} /> {carriedCount} carried forward)
                    </span>
                  )}
                </p>
                {photos.length === 0 ? (
                  <p className="text-[0.6875rem] text-muted-foreground/70 flex items-center gap-1">
                    <ImageOff size={11} /> None yet
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {photos.map((p) => (
                      <PhotoThumb key={p.id} rungId={rungId} photo={p} onOpen={() => setLightboxPhoto(p)} onDeleted={refresh} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lightboxPhoto && <PhotoLightbox rungId={rungId} photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />}
    </div>
  );
}

// ── Blueprint tab ────────────────────────────────────────────────────────

function BlueprintTab({ rungId, roomId }: { rungId: number; roomId: number }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["blueprint-annotation-history", rungId, roomId],
    queryFn: () => getBlueprintAnnotationHistory(rungId, roomId, "allocation"),
  });
  const [revIndex, setRevIndex] = useState(0);
  const [zoom, setZoom] = useState(1);

  // Resets to the latest revision whenever a (different) blueprint's
  // history loads — never leaves the scrubber stuck mid-history from a
  // previously opened activity.
  useEffect(() => {
    if (history && history.length > 0) setRevIndex(history.length - 1);
  }, [history]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!history || history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <ImageOff size={22} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No blueprint markup saved for this activity yet.</p>
      </div>
    );
  }

  const rev = history[revIndex];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRevIndex((i) => Math.max(0, i - 1))}
            disabled={revIndex === 0}
            className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-xs font-heading font-semibold text-foreground px-1.5">
            Rev {rev.version} <span className="text-muted-foreground font-normal">of {history.length}</span>
          </span>
          <button
            type="button"
            onClick={() => setRevIndex((i) => Math.min(history.length - 1, i + 1))}
            disabled={revIndex === history.length - 1}
            className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ChevronRight size={13} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            disabled={zoom <= 1}
            className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
            disabled={zoom >= 3}
            className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/10 overflow-auto max-h-[52vh]">
        {rev.thumbnailBase64 ? (
          <img
            src={`data:image/png;base64,${rev.thumbnailBase64}`}
            alt={`Blueprint revision ${rev.version}`}
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
            className="block max-w-none"
          />
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">No preview for this revision.</div>
        )}
      </div>

      <p className="text-[0.6875rem] text-muted-foreground text-center">
        {rev.updatedBy ? `${rev.updatedBy} · ` : ""}
        {fmtDateTime(rev.updatedAt)}
      </p>
    </div>
  );
}

// ── Attendance tab ───────────────────────────────────────────────────────
// Same activity-scoped roster + day-wise attendance as the standalone
// Worker Attendance page (src/pages/civilworkdpr/WorkerAttendance.tsx),
// just pinned to this rung — the natural place to check "who worked on
// this activity" alongside its Overview/Photos.
// Stable fallback while the attendance query has no data yet (loading or
// failed): a fresh `[]` default every render made the status-sync effect
// below (deps: [attendanceRows]) setState on every render, looping forever.
const NO_ATTENDANCE_ROWS: never[] = [];

function AttendanceTab({ rungId }: { rungId: number }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const [statusByWorker, setStatusByWorker] = useState<Record<number, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);

  const { data: attendanceRows = NO_ATTENDANCE_ROWS, isFetching } = useQuery({
    queryKey: ["workerAttendanceAttendance", rungId, date],
    queryFn: () => getAttendance(rungId, date),
    staleTime: 10 * 1000,
  });

  useEffect(() => {
    const next: Record<number, AttendanceStatus> = {};
    for (const row of attendanceRows) next[row.workerId] = row.status ?? "P";
    setStatusByWorker(next);
  }, [attendanceRows]);

  const existingWorkerIds = useMemo(() => new Set(attendanceRows.map((r) => r.workerId)), [attendanceRows]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["workerAttendanceAttendance", rungId, date] });

  const handleRemoveWorker = async (workerId: number) => {
    try {
      await removeFromRoster(rungId, workerId);
      toast.success("Worker removed from this activity");
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove worker");
    }
  };

  const handleSave = async () => {
    const entries = attendanceRows.map((r) => ({ workerId: r.workerId, status: statusByWorker[r.workerId] ?? "P" }));
    if (!entries.length) return;
    setSaving(true);
    try {
      await saveAttendance({ rungId, date, entries });
      toast.success("Attendance saved");
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays size={12} /> Date
        </label>
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-auto`} />
      </div>

      {isFetching ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading attendance…
        </div>
      ) : attendanceRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          <Users2 size={22} className="mx-auto opacity-30 mb-2" />
          <p className="text-sm">No workers assigned to this activity yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border/60 overflow-hidden">
          {attendanceRows.map((row) => {
            const status = statusByWorker[row.workerId] ?? "P";
            return (
              <div key={row.workerId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{row.workerName}</p>
                  <p className="text-[0.625rem] text-muted-foreground truncate">{row.contractorName || row.skillType}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={status}
                    onChange={(e) => setStatusByWorker((prev) => ({ ...prev, [row.workerId]: e.target.value as AttendanceStatus }))}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${STATUS_CLS[status]} focus:outline-none`}
                  >
                    {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRemoveWorker(row.workerId)}
                    title="Remove from activity"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
                  >
                    <UserX size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setAddWorkerOpen(true)}
          className="flex items-center gap-1.5 text-sm text-cyan-600 hover:text-cyan-500 font-medium"
        >
          <Plus size={14} /> Add Worker
        </button>
        <button
          onClick={handleSave}
          disabled={saving || attendanceRows.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Attendance
        </button>
      </div>

      <AddWorkerDialog
        open={addWorkerOpen}
        onOpenChange={setAddWorkerOpen}
        rungId={rungId}
        existingWorkerIds={existingWorkerIds}
        onAdded={refresh}
      />
    </div>
  );
}

// ── Checkpoints tab ──────────────────────────────────────────────────────
// The interactive checklist — checking off happens HERE, in Reporting, not
// in Work Allocation (RungAssignmentModal, which now only shows these
// read-only). What's on the list is configured in Activity Master and
// auto-seeded onto this rung's assignment the first time it's fetched (see
// dependencyActivityAssignment.js's GET /:rungId); nothing is added or
// removed from this tab.
function CheckpointsTab({ rungId }: { rungId: number }) {
  const queryClient = useQueryClient();
  const [checkpoints, setCheckpoints] = useState<AssignmentCheckpoint[]>([]);
  const [saving, setSaving] = useState<number | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["dependency-activity-assignment", rungId],
    queryFn: () => getRungAssignment(rungId),
  });

  useEffect(() => {
    setCheckpoints(detail?.assignment?.checkpoints || []);
  }, [detail]);

  const startDate = detail?.assignment?.startDate ? detail.assignment.startDate.slice(0, 10) : "";

  // Same rule the server enforces on save (dependencyActivityAssignment.js
  // POST /:rungId) — caught here first for an immediate, specific reason
  // instead of a save-time rejection.
  const checkpointGate = (cp: AssignmentCheckpoint): { locked: boolean; daysLeft: number | null } => {
    if (cp.isChecked || cp.minWaitDays == null || cp.minWaitDays <= 0) return { locked: false, daysLeft: null };
    if (!startDate) return { locked: true, daysLeft: null };
    const eligibleDate = addDays(startDate, cp.minWaitDays);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (todayStr >= eligibleDate) return { locked: false, daysLeft: null };
    return { locked: true, daysLeft: diffDays(todayStr, eligibleDate) };
  };

  const toggleCheckpoint = async (index: number) => {
    if (!detail?.assignment) return;
    const cp = checkpoints[index];
    if (!cp.isChecked) {
      const gate = checkpointGate(cp);
      if (gate.locked) {
        toast.error(
          startDate
            ? `"${cp.fieldName}" needs ${cp.minWaitDays} day(s) after the start date — ${gate.daysLeft ?? cp.minWaitDays} day(s) left.`
            : `"${cp.fieldName}" needs a Start Date set (in Work Allocation) before it can be checked off.`,
        );
        return;
      }
    }
    const next = checkpoints.map((c, i) => (i === index ? { ...c, isChecked: !c.isChecked } : c));
    setCheckpoints(next);
    setSaving(index);
    try {
      const a = detail.assignment;
      await saveRungAssignment(rungId, {
        engineerIds: a.engineerIds,
        qcUserIds: a.qcUserIds,
        approvalLevels: a.approvalLevels,
        startDate: a.startDate,
        days: a.days,
        endDate: a.endDate,
        labourSource: a.labourSource,
        materialSource: a.materialSource,
        labourContractorId: a.labourContractorId,
        materialContractorId: a.materialContractorId,
        description: a.description,
        remarks: a.remarks,
        materials: a.materials,
        checkpoints: next,
      });
      await queryClient.invalidateQueries({ queryKey: ["dependency-activity-assignment", rungId] });
    } catch (err: any) {
      setCheckpoints(checkpoints); // revert the optimistic toggle
      toast.error(err.message || "Failed to save checkpoint");
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading checkpoints…
      </div>
    );
  }

  if (checkpoints.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic text-center py-10">
        No checkpoints tagged to this activity — add them in Activity Master.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {checkpoints.map((cp, i) => {
        const gate = checkpointGate(cp);
        return (
          <div key={`${cp.checkpointId ?? "custom"}-${i}`} className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0">
              <button
                type="button"
                onClick={() => toggleCheckpoint(i)}
                disabled={saving === i}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors disabled:opacity-50 ${
                  cp.isChecked
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : gate.locked
                      ? "bg-background border-amber-500/40 text-transparent"
                      : "bg-background border-border text-transparent hover:border-cyan-500/50"
                }`}
                title={cp.isChecked ? "Mark incomplete" : gate.locked ? "Not eligible yet" : "Mark complete"}
              >
                {saving === i ? <Loader2 size={10} className="animate-spin text-muted-foreground" /> : <Check size={11} strokeWidth={3} />}
              </button>
              {i < checkpoints.length - 1 && (
                <div className={`w-0.5 flex-1 min-h-[18px] ${cp.isChecked ? "bg-emerald-500/40" : "bg-border"}`} />
              )}
            </div>
            <div className="flex-1 min-w-0 pb-3 pt-0.5">
              <span className={`text-sm flex items-center gap-1.5 flex-wrap ${cp.isChecked ? "text-foreground" : "text-foreground/90"}`}>
                {cp.fieldName}
                {cp.isDaily && (
                  <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">
                    <CalendarDays size={9} /> Daily
                  </span>
                )}
                {gate.locked && (
                  <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-amber-600 dark:text-amber-400 bg-[#ffe2021a] px-1.5 py-0.5 rounded-full">
                    <Timer size={9} /> {gate.daysLeft != null ? `${gate.daysLeft}d left` : `${cp.minWaitDays}d wait`}
                  </span>
                )}
              </span>
              {cp.isDaily && <CheckpointDailyUpdates checkpointId={cp.id} startDate={startDate || undefined} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function OverviewTab({ row }: { row: ReportedAssignment }) {
  const queryClient = useQueryClient();
  const [remarks, setRemarks] = useState(row.remarks ?? "");
  const remarksMutation = useMutation({
    mutationFn: (next: string) => updateAssignmentDetail(row.rungId, { remarks: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save remarks."),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Field label="Engineer">
          <span className="flex items-center gap-1.5">
            <UserRound size={13} className="text-muted-foreground" />
            {row.engineerNames || <span className="italic text-muted-foreground">Unassigned</span>}
          </span>
        </Field>
        <Field label="Start Date">
          <span className="flex items-center gap-1.5">
            <CalendarDays size={13} className="text-muted-foreground" />
            {row.startDate ? new Date(row.startDate).toLocaleDateString("en-IN") : "—"}
          </span>
          {(() => {
            const delay = startDelayInfo(row.startDate, row.firstReportedAt);
            if (!delay) return null;
            return (
              <span
                className={`mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.625rem] font-medium ${
                  delay.tone === "on-time"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-[#ffe2021a] text-amber-600 dark:text-amber-400"
                }`}
              >
                {delay.label}
              </span>
            );
          })()}
        </Field>
        <Field label="End Date">{row.endDate ? new Date(row.endDate).toLocaleDateString("en-IN") : "—"}</Field>
        <Field label="Days">{row.days ?? "—"}</Field>
        <Field label="Labour Source">{row.labourSource ?? "—"}</Field>
        <Field label="Material Source">{row.materialSource ?? "—"}</Field>
      </div>

      {row.description && <Field label="Description">{row.description}</Field>}

      <Field label={`Materials · ${row.materials.length}`}>
        {row.materials.length === 0 ? (
          <span className="text-muted-foreground text-xs">None linked</span>
        ) : (
          <div className="flex flex-col gap-1 mt-1">
            {row.materials.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5 text-xs">
                <Package size={11} className="text-muted-foreground shrink-0" />
                {m.name}
                <span className="text-muted-foreground">
                  · {m.quantity}
                  {m.uom ? ` ${m.uom}` : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </Field>

      <div>
        <p className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground mb-1">Remarks</p>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => {
            if (remarks !== (row.remarks ?? "")) remarksMutation.mutate(remarks);
          }}
          rows={3}
          placeholder="Add a note about this activity…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 resize-none"
        />
        {remarksMutation.isPending && (
          <p className="text-[0.625rem] text-muted-foreground mt-1 flex items-center gap-1">
            <Loader2 size={9} className="animate-spin" /> Saving…
          </p>
        )}
      </div>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────
// Docked below the tabbed content, inside the modal — a draggable
// percent-done bar. Dragging only moves the thumb visually now; nothing
// reaches the server until the engineer explicitly clicks Save, which also
// logs the change (who, when, from/to %) to the history list right below
// the bar — every past save is visible there, newest first. Two rules,
// both enforced here AND server-side (dependencyActivityAssignment.js's
// PATCH /:rungId/status — never trust the client alone for either):
//  - One-way ratchet: it can only move forward. Dragging to 45% means the
//    bar can go on to 50 but never back down to 40 — the track itself is
//    clamped so the thumb physically can't be pulled below the last saved
//    value, not just rejected on release.
//  - Locked once Completed: reaching 100% bundles status: "COMPLETED" into
//    the same Save request (what sends the activity to Quality Check), and
//    from then on the whole bar is frozen — no more dragging at all,
//    forward or back. A mistaken 100% now goes through QC sending it back
//    for rework (a fresh attempt), not a drag on this same bar.
function ProgressDragBar({ row }: { row: ReportedAssignment }) {
  const queryClient = useQueryClient();
  const trackRef = useRef<HTMLDivElement>(null);
  const saved = row.progressPercent ?? 0;
  const locked = row.status === "COMPLETED";
  const [percent, setPercent] = useState(saved);
  const [dragging, setDragging] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const dirty = percent !== saved;

  useEffect(() => {
    if (!dragging) setPercent(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.rungId, saved]);

  const { data: log = [], isLoading: logLoading } = useQuery({
    queryKey: ["activity-progress-log", row.rungId],
    queryFn: () => getProgressLog(row.rungId),
    enabled: showLog,
  });

  const mutation = useMutation({
    mutationFn: (patch: { progressPercent: number; status?: AssignmentStatus }) =>
      updateAssignmentDetail(row.rungId, patch),
    onSuccess: (_res, patch) => {
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      queryClient.invalidateQueries({ queryKey: ["qc-queue"] });
      queryClient.invalidateQueries({ queryKey: ["activity-progress-log", row.rungId] });
      if (patch.status === "COMPLETED") toast.success("Activity completed — sent to Quality Check.");
      else toast.success("Progress saved.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to save progress.");
      setPercent(saved);
    },
  });

  // Clamped to [saved, 100] — the floor is the last saved value (the
  // ratchet), never 0, so the drag itself can't go backward.
  const percentFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return percent;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(saved, Math.min(100, Math.round(ratio * 100)));
  };

  const commit = (next: number) => {
    if (next === saved) return;
    const patch: { progressPercent: number; status?: AssignmentStatus } = { progressPercent: next };
    if (next === 100 && row.status !== "COMPLETED") patch.status = "COMPLETED";
    mutation.mutate(patch);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setPercent(percentFromClientX(e.clientX));
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || locked) return;
    setPercent(percentFromClientX(e.clientX));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || locked) return;
    setDragging(false);
    setPercent(percentFromClientX(e.clientX));
  };

  return (
    <div className="px-4 py-3 border-t border-border shrink-0 bg-muted/10">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.625rem] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <TrendingUp size={11} /> Work Done
          {locked && <Lock size={10} className="text-muted-foreground/70" />}
        </span>
        <span className="text-xs font-heading font-bold text-foreground tabular-nums flex items-center gap-1">
          {mutation.isPending && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
          {percent}%
        </span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title={locked ? "Locked — this activity is Completed" : undefined}
        className={`relative h-3 rounded-full bg-muted touch-none select-none ${locked ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
          style={{ width: `${percent}%`, transition: dragging ? "none" : "width 150ms ease-out" }}
        />
        <div
          className="absolute top-1/2 w-4 h-4 rounded-full bg-white border-2 border-cyan-500 shadow-md -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${percent}%`, transition: dragging ? "none" : "left 150ms ease-out" }}
        />
      </div>

      <div className="flex items-center justify-between mt-2.5">
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="flex items-center gap-1 text-[0.625rem] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <History size={10} /> {showLog ? "Hide" : "Show"} update log
        </button>
        {!locked && dirty && (
          <button
            type="button"
            onClick={() => commit(percent)}
            disabled={mutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-600 text-white text-[0.6875rem] font-heading font-semibold hover:bg-cyan-700 disabled:opacity-60 transition-colors"
          >
            {mutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Save
          </button>
        )}
      </div>

      {showLog && (
        <div className="mt-2 rounded-lg border border-border bg-background/60 max-h-40 overflow-y-auto">
          {logLoading ? (
            <p className="text-[0.6875rem] text-muted-foreground text-center py-3">Loading…</p>
          ) : log.length === 0 ? (
            <p className="text-[0.6875rem] text-muted-foreground text-center py-3">No updates logged yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {log.map((entry) => (
                <div key={entry.id} className="px-3 py-1.5 text-[0.6875rem]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {entry.fromProgressPercent != null && entry.toProgressPercent != null
                        ? `${entry.fromProgressPercent}% → ${entry.toProgressPercent}%`
                        : entry.remarks
                          ? "Remarks updated"
                          : "Updated"}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(entry.loggedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-muted-foreground/80 truncate">{entry.loggedBy || "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────────────
// Every past attempt at this rung — only shown once there's more than one
// (a rework fork happened via QC or an Approval rejection). Read-only:
// this is the "keep the history of the reworked task" record, not
// something acted on here.
const REWORK_SOURCE_LABEL: Record<string, string> = { QC: "Quality Check", APPROVAL: "Approval" };

function HistoryTab({ rungId }: { rungId: number }) {
  const { data: attempts = [], isLoading } = useQuery({
    queryKey: ["activity-attempts", rungId],
    queryFn: () => getAssignmentAttempts(rungId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading history…
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {attempts.map((a, i) => (
        <div key={a.assignmentId} className="flex items-start gap-3">
          <div className="flex flex-col items-center shrink-0">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                a.isCurrent ? "bg-cyan-500 border-cyan-500 text-white" : "bg-background border-border text-transparent"
              }`}
            >
              {a.isCurrent && <Check size={11} strokeWidth={3} />}
            </div>
            {i < attempts.length - 1 && <div className="w-0.5 flex-1 min-h-[18px] bg-border" />}
          </div>
          <div className="flex-1 min-w-0 pb-4 pt-0.5">
            <span className="text-sm flex items-center gap-1.5 flex-wrap text-foreground font-medium">
              Attempt {a.attemptNo}
              {a.isCurrent && (
                <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">
                  Current
                </span>
              )}
              <span className="text-xs font-normal text-muted-foreground">
                · {ASSIGNMENT_STATUS_META[a.status]?.label ?? a.status}
              </span>
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {a.engineerNames || "Unassigned"}
              {a.startDate ? ` · Started ${new Date(a.startDate).toLocaleDateString("en-IN")}` : ""}
            </p>
            {a.reworkReason && (
              <p className="text-xs mt-1.5 flex items-start gap-1.5 text-fuchsia-700 dark:text-fuchsia-400">
                <RotateCcw size={11} className="shrink-0 mt-0.5" />
                <span>
                  Sent back for rework via {REWORK_SOURCE_LABEL[a.reworkSource || ""] || "unknown"}: {a.reworkReason}
                </span>
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Daily Log tab ────────────────────────────────────────────────────────
// One permanent snapshot per day this activity was reported on (see the
// PATCH /:rungId/status route's MERGE) — newest first. Photos for a day are
// fetched lazily on expand since most days won't be opened.
function DailyLogDayPhotos({ rungId, logDate }: { rungId: number; logDate: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["activity-photos", rungId, logDate],
    queryFn: () => getActivityPhotos(rungId, logDate),
  });
  const [lightboxPhoto, setLightboxPhoto] = useState<ActivityPhotoMeta | null>(null);
  const all = [...(data?.before ?? []), ...(data?.after ?? [])];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (all.length === 0) {
    return <p className="text-[0.6875rem] text-muted-foreground/70 flex items-center gap-1 py-1"><ImageOff size={11} /> No photos logged this day</p>;
  }
  return (
    <>
      <div className="flex flex-wrap gap-2 pt-1">
        {all.map((p) => (
          <PhotoThumb key={p.id} rungId={rungId} photo={p} onOpen={() => setLightboxPhoto(p)} onDeleted={() => {}} />
        ))}
      </div>
      {lightboxPhoto && <PhotoLightbox rungId={rungId} photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />}
    </>
  );
}

function DailyLogTab({ rungId }: { rungId: number }) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["activity-daily-log", rungId],
    queryFn: () => getDailyLog(rungId),
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading daily log…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <CalendarClock size={22} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No daily entries logged yet — saving progress or remarks today creates one.</p>
      </div>
    );
  }

  const todayStr = todayIso();

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        const isToday = entry.logDate === todayStr;
        const isOpen = expanded === entry.logDate;
        return (
          <div key={entry.id} className="rounded-xl border border-border bg-muted/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : entry.logDate)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex flex-col items-start shrink-0 w-24">
                <span className="text-sm font-heading font-semibold text-foreground">
                  {new Date(entry.logDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </span>
                {isToday && (
                  <span className="text-[0.625rem] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">
                    Today
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">{entry.remarks || <span className="text-muted-foreground italic">No remarks</span>}</p>
                <p className="text-[0.6875rem] text-muted-foreground mt-0.5 flex items-center gap-2">
                  {entry.progressPercent != null && (
                    <span className="flex items-center gap-1">
                      <TrendingUp size={10} /> {entry.progressPercent}%
                    </span>
                  )}
                  {entry.photoCount > 0 && (
                    <span className="flex items-center gap-1">
                      <CameraIcon size={10} /> {entry.photoCount}
                    </span>
                  )}
                  {entry.updatedBy && <span>· {entry.updatedBy}</span>}
                </p>
              </div>
              {isOpen ? <ChevronLeft size={14} className="rotate-90 text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
            </button>
            {isOpen && (
              <div className="px-3.5 pb-3 border-t border-border">
                <DailyLogDayPhotos rungId={rungId} logDate={entry.logDate} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Restore (Cancelled only, super_admin only) ──────────────────────────
// Bringing a Cancelled activity back is a rare, deliberate override — kept
// out of the plain status dropdown (that badge stays terminal once
// Cancelled) and behind an explicit confirm step here, only reachable
// after opening this modal and reviewing the activity's full detail. The
// target status (APPROVED vs IN_PROGRESS) is decided server-side from
// PreCancelStatus, but shown here up front so the confirm step isn't a
// guess — see restoreCancelledActivity's own comment.
function RestoreCancelledButton({ row, onClose }: { row: ReportedAssignment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const restoreTo: AssignmentStatus = row.preCancelStatus === "APPROVED" ? "APPROVED" : "IN_PROGRESS";

  const restore = useMutation({
    mutationFn: () => restoreCancelledActivity(row.rungId),
    onSuccess: (res) => {
      toast.success(`Restored — back to ${ASSIGNMENT_STATUS_META[res.status].label}.`);
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      setConfirmOpen(false);
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to restore this activity."),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-heading font-bold uppercase tracking-wide border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-[#ffe2021a] transition-colors"
        title="Restore this Cancelled activity"
      >
        <ShieldQuestion size={12} /> Restore
      </button>

      {confirmOpen &&
        createPortal(
          <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
            <div
              className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#ffe2021a] flex items-center justify-center shrink-0">
                  <ShieldQuestion size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-heading font-semibold text-foreground">Restore this activity?</p>
                  <p className="text-xs text-muted-foreground">{row.activityName}</p>
                </div>
              </div>
              <p className="text-xs text-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
                It will move from <span className="font-semibold">Cancelled</span> back to{" "}
                <span className="font-semibold">{ASSIGNMENT_STATUS_META[restoreTo].label}</span>
                {restoreTo === "IN_PROGRESS" && " — it hadn't been approved yet, so it goes through Reporting/QC/Approval again from there"}.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors"
                >
                  {restore.isPending && <Loader2 size={14} className="animate-spin" />}
                  Restore
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────

const TABS: Array<{ id: DetailTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: ActivityIcon },
  { id: "blueprint", label: "Blueprint", icon: ScanLine },
  { id: "photos", label: "Photos", icon: CameraIcon },
  { id: "attendance", label: "Attendance", icon: Users2 },
  { id: "checkpoints", label: "Checkpoints", icon: ListChecks },
  { id: "daily-log", label: "Daily Log", icon: CalendarClock },
  { id: "history", label: "History", icon: History },
];

export default function ActivityDetailModal({
  row,
  initialTab = "overview",
  onClose,
}: {
  row: ReportedAssignment;
  initialTab?: DetailTab;
  onClose: () => void;
}) {
  useOverlayBackClose(onClose);
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const { currentUser } = useAuth();
  const canRestore = currentUser?.role === "super_admin" && row.status === "CANCELLED";

  const { data: annotation } = useQuery({
    queryKey: ["blueprint-annotation", row.rungId, row.roomId, "allocation"],
    queryFn: () => getBlueprintAnnotation(row.rungId, row.roomId as number, "allocation"),
    enabled: row.roomId != null,
  });
  const { data: photos } = useQuery({
    queryKey: ["activity-photos", row.rungId],
    queryFn: () => getActivityPhotos(row.rungId),
  });

  const hasBlueprint = row.roomId != null && !!annotation;
  const photoCount = (photos?.before.length ?? 0) + (photos?.after.length ?? 0);

  const visibleTabs = useMemo(
    () =>
      TABS.filter((t) => t.id !== "blueprint" || hasBlueprint)
        .filter((t) => t.id !== "history" || row.attemptNo > 1),
    [hasBlueprint, row.attemptNo],
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] rounded-2xl overflow-hidden">
        <CivilWorkDprShell
          fillHeight
          title={row.activityName}
          subtitle={row.scopePath}
          icon={ActivityIcon}
          action={
            <div className="flex items-center gap-2.5">
              <QcBadge qcStatus={row.qcStatus} />
              <AttemptBadge attemptNo={row.attemptNo} />
              {canRestore && <RestoreCancelledButton row={row} onClose={onClose} />}
              <AssignmentStatusSelect rungId={row.rungId} status={row.status} />
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={18} />
              </button>
            </div>
          }
        >
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-1 px-4 pt-3 border-b border-border shrink-0">
              {visibleTabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-heading font-semibold border-b-2 transition-colors ${
                      active ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon size={13} />
                    {t.label}
                    {t.id === "photos" && photoCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[0.5625rem] font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                        {photoCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {tab === "overview" && <OverviewTab row={row} />}
              {tab === "blueprint" && row.roomId != null && <BlueprintTab rungId={row.rungId} roomId={row.roomId} />}
              {tab === "photos" && <PhotosTab rungId={row.rungId} />}
              {tab === "attendance" && <AttendanceTab rungId={row.rungId} />}
              {tab === "checkpoints" && <CheckpointsTab rungId={row.rungId} />}
              {tab === "daily-log" && <DailyLogTab rungId={row.rungId} />}
              {tab === "history" && <HistoryTab rungId={row.rungId} />}
            </div>

            <ProgressDragBar row={row} />
          </div>
        </CivilWorkDprShell>
      </div>
    </div>,
    document.body,
  );
}
