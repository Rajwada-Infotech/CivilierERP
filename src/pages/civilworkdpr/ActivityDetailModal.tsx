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
  type PhotoPhase,
  type ActivityPhotoMeta,
  type ReportedAssignment,
} from "@/api/dependencyActivityAssignmentApi";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import { useOverlayBackClose } from "@/hooks/useOverlayBackClose";
import { useCameraCapture } from "@/hooks/useCameraCapture";

type DetailTab = "overview" | "blueprint" | "photos";

const TAG_META: Record<PhotoPhase, { label: string; icon: LucideIcon; color: string }> = {
  before: { label: "Before", icon: Clock, color: "#f59e0b" },
  after: { label: "After", icon: CheckCircle2, color: "#22c55e" },
  progress: { label: "Progress", icon: ActivityIcon, color: "#38bdf8" },
};
const TAG_ORDER: PhotoPhase[] = ["before", "after", "progress"];

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

  const addPhoto = async (blob: Blob) => {
    setUploading(true);
    try {
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
    if (!ok) fileInputRef.current?.click();
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-medium border transition-colors"
              style={
                active
                  ? { background: `${meta.color}1A`, borderColor: `${meta.color}60`, color: meta.color }
                  : { borderColor: "var(--border)", color: "var(--muted-foreground)" }
              }
            >
              <Icon size={12} /> {meta.label}
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-heading font-semibold text-white transition-transform hover:scale-105"
              style={{ background: `linear-gradient(135deg, ${TAG_META[activeTag].color}, ${TAG_META[activeTag].color}cc)` }}
            >
              <CameraIcon size={16} /> Open camera
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Upload size={11} /> Upload instead
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {TAG_ORDER.map((tag) => {
            const meta = TAG_META[tag];
            const Icon = meta.icon;
            const photos = data?.[tag] ?? [];
            return (
              <div key={tag} className="pl-3 border-l-2" style={{ borderColor: `${meta.color}45` }}>
                <p className="flex items-center gap-1 text-[10px] font-heading font-semibold uppercase tracking-wide mb-2" style={{ color: meta.color }}>
                  <Icon size={10} /> {meta.label} · {photos.length}
                </p>
                {photos.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
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

      <p className="text-[11px] text-muted-foreground text-center">
        {rev.updatedBy ? `${rev.updatedBy} · ` : ""}
        {fmtDateTime(rev.updatedAt)}
      </p>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
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
        <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-1">Remarks</p>
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
          <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
            <Loader2 size={9} className="animate-spin" /> Saving…
          </p>
        )}
      </div>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────

const TABS: Array<{ id: DetailTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: ActivityIcon },
  { id: "blueprint", label: "Blueprint", icon: ScanLine },
  { id: "photos", label: "Photos", icon: CameraIcon },
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
  const photoCount = (photos?.before.length ?? 0) + (photos?.after.length ?? 0) + (photos?.progress.length ?? 0);

  const visibleTabs = useMemo(() => TABS.filter((t) => t.id !== "blueprint" || hasBlueprint), [hasBlueprint]);

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] rounded-2xl overflow-hidden">
        <CivilWorkDprShell
          fillHeight
          title={row.activityName}
          subtitle={row.scopePath}
          icon={ActivityIcon}
          action={
            <div className="flex items-center gap-3">
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
                      <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
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
            </div>
          </div>
        </CivilWorkDprShell>
      </div>
    </div>,
    document.body,
  );
}
