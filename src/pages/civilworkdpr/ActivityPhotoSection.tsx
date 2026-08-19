import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Camera, Loader2, Trash2, Clock, CheckCircle2, ImageOff, type LucideIcon } from "lucide-react";
import {
  getActivityPhotos,
  getActivityPhoto,
  uploadActivityPhoto,
  deleteActivityPhoto,
  type PhotoPhase,
  type ActivityPhotoMeta,
} from "@/api/dependencyActivityAssignmentApi";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { useOverlayBackClose } from "@/hooks/useOverlayBackClose";

const PHOTO_ACCEPT = "image/*";

// Before = where things stood at the start (amber, "in progress" energy);
// After = the completed result (emerald, matches the app's "done" color
// everywhere else). Giving each phase its own identity is the point — a
// lead scanning this should never have to read the label to tell which
// side they're looking at.
const PHASE_META: Record<PhotoPhase, { label: string; icon: LucideIcon; color: string }> = {
  before: { label: "Before", icon: Clock, color: "#f59e0b" },
  after: { label: "After", icon: CheckCircle2, color: "#22c55e" },
};

function fmtCapturedAt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Full-size viewer — a proper in-app lightbox instead of window.open(blob
// url). window.open() called after an await (fetching the photo first) is
// exactly the pattern browsers' popup blockers silently kill, since it's
// no longer within the same synchronous tick as the click that triggered
// it — the "new tab never opened" bug. A lightbox sidesteps that entirely
// and reads as a real gallery besides.
function PhotoLightbox({
  rungId,
  photo,
  onClose,
  onDeleted,
}: {
  rungId: number;
  photo: ActivityPhotoMeta;
  onClose: () => void;
  onDeleted: () => void;
}) {
  useOverlayBackClose(onClose);
  const { data, isLoading } = useQuery({
    queryKey: ["activity-photo", rungId, photo.id],
    queryFn: () => getActivityPhoto(rungId, photo.id),
    staleTime: 5 * 60_000,
  });
  const [deleting, setDeleting] = useState(false);
  const meta = PHASE_META[photo.phase];
  const Icon = meta.icon;

  const handleDelete = async () => {
    if (!window.confirm("Delete this photo?")) return;
    setDeleting(true);
    try {
      await deleteActivityPhoto(rungId, photo.id);
      onDeleted();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Could not delete photo");
      setDeleting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-6" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
      >
        <X size={18} />
      </button>
      <div className="max-w-4xl max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {isLoading || !data ? (
          <div className="w-[60vw] max-w-md aspect-video flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-white/60" />
          </div>
        ) : (
          <img
            src={`data:${data.mimeType};base64,${data.dataBase64}`}
            alt={photo.fileName}
            className="max-w-full max-h-[75vh] rounded-xl shadow-2xl object-contain"
          />
        )}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/70">
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: meta.color }}>
            <Icon size={12} /> {meta.label}
          </span>
          <span>{fmtCapturedAt(photo.capturedAt)}</span>
          {photo.capturedBy && <span>· {photo.capturedBy}</span>}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1 text-white/60 hover:text-destructive transition-colors disabled:opacity-50"
          >
            {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PhotoThumb({
  rungId,
  photo,
  onOpen,
}: {
  rungId: number;
  photo: ActivityPhotoMeta;
  onOpen: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["activity-photo", rungId, photo.id],
    queryFn: () => getActivityPhoto(rungId, photo.id),
    staleTime: 5 * 60_000,
  });

  return (
    <button
      type="button"
      onClick={onOpen}
      title={photo.fileName}
      className="relative w-24 h-24 shrink-0 rounded-xl border border-border overflow-hidden bg-muted/30 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-foreground/30 transition-all"
    >
      {data ? (
        <img
          src={`data:${data.mimeType};base64,${data.dataBase64}`}
          alt={photo.fileName}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      )}
    </button>
  );
}

// A phase's gallery panel for one day — a colored accent bar down the left
// edge carries the Before/Amber vs After/Emerald identity, matching an
// album divider rather than a plain text label.
function PhasePanel({
  rungId,
  phase,
  photos,
  onOpen,
}: {
  rungId: number;
  phase: PhotoPhase;
  photos: ActivityPhotoMeta[];
  onOpen: (photo: ActivityPhotoMeta) => void;
}) {
  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  return (
    <div className="shrink-0 pl-3 border-l-2" style={{ borderColor: `${meta.color}45` }}>
      <p className="flex items-center gap-1 text-[10px] font-heading font-semibold uppercase tracking-wide mb-2" style={{ color: meta.color }}>
        <Icon size={10} /> {meta.label} · {photos.length}
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <PhotoThumb key={p.id} rungId={rungId} photo={p} onOpen={() => onOpen(p)} />
        ))}
      </div>
    </div>
  );
}

// The persistent "capture today's shot" control — always adds against
// today's date (the server stamps CapturedAt), which is what starts a new
// link in the gallery chain below the first time either phase is used
// that day.
function UploadButton({ rungId, phase, onUploaded }: { rungId: number; phase: PhotoPhase; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const meta = PHASE_META[phase];
  const Icon = meta.icon;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadActivityPhoto(rungId, phase, file);
      }
      onUploaded();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-colors disabled:opacity-50 hover:brightness-110"
        style={{ borderColor: `${meta.color}40`, background: `${meta.color}0F` }}
      >
        {uploading ? (
          <Loader2 size={15} className="animate-spin" style={{ color: meta.color }} />
        ) : (
          <Icon size={15} style={{ color: meta.color }} />
        )}
        <span className="text-xs font-semibold" style={{ color: meta.color }}>
          {uploading ? "Uploading…" : `Add ${meta.label} Photo`}
        </span>
      </button>
    </>
  );
}

interface DateGroup {
  dateKey: string;
  before: ActivityPhotoMeta[];
  after: ActivityPhotoMeta[];
}

function groupByDate(before: ActivityPhotoMeta[], after: ActivityPhotoMeta[]): DateGroup[] {
  const map = new Map<string, DateGroup>();
  const bucket = (p: ActivityPhotoMeta, phase: PhotoPhase) => {
    const key = p.capturedAt.slice(0, 10);
    if (!map.has(key)) map.set(key, { dateKey: key, before: [], after: [] });
    map.get(key)![phase].push(p);
  };
  before.forEach((p) => bucket(p, "before"));
  after.forEach((p) => bucket(p, "after"));
  // Oldest first — the chain reads top-to-bottom as the activity's progress
  // over time, same narrative convention as this app's other chain views
  // (e.g. Loan Sanction's Repayment History).
  return Array.from(map.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function fmtDateHeading(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ActivityPhotoSection({
  rungId,
  roomLabel,
  onClose,
}: {
  rungId: number;
  roomLabel: string;
  onClose: () => void;
}) {
  useOverlayBackClose(onClose);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["activity-photos", rungId],
    queryFn: () => getActivityPhotos(rungId),
  });
  const [lightboxPhoto, setLightboxPhoto] = useState<ActivityPhotoMeta | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["activity-photos", rungId] });

  const dateGroups = useMemo(() => groupByDate(data?.before ?? [], data?.after ?? []), [data]);

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] rounded-2xl overflow-hidden">
            <CivilWorkDprShell
              fillHeight
              title="Before / After Photos"
              subtitle={roomLabel}
              icon={Camera}
              action={
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X size={18} />
                </button>
              }
            >
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
                {/* Persistent capture controls — every upload lands on today's
                    date and either starts or extends today's link in the
                    chain below. */}
                <div className="flex gap-2.5 p-4 border-b border-border shrink-0">
                  <UploadButton rungId={rungId} phase="before" onUploaded={refresh} />
                  <UploadButton rungId={rungId} phase="after" onUploaded={refresh} />
                </div>

                {/* Gallery chain — one link per calendar day a photo was captured. */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={20} className="animate-spin text-muted-foreground" />
                    </div>
                  ) : dateGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                      <ImageOff size={22} className="text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No photos yet — add a before/after shot above.</p>
                    </div>
                  ) : (
                    dateGroups.map((group, i) => (
                      <div key={group.dateKey} className="flex gap-3">
                        <div className="flex flex-col items-center shrink-0 w-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" style={{ marginTop: 5 }} />
                          {i < dateGroups.length - 1 && <div className="w-px flex-1 bg-border" style={{ marginTop: 6 }} />}
                        </div>
                        <div className={`flex-1 min-w-0 ${i < dateGroups.length - 1 ? "pb-4" : ""}`}>
                          <div className="rounded-xl border border-border bg-muted/10 p-3.5">
                            <p className="text-xs font-heading font-semibold text-foreground mb-3">
                              {fmtDateHeading(group.dateKey)}
                            </p>
                            <div className="flex flex-wrap gap-6">
                              {group.before.length > 0 && (
                                <PhasePanel rungId={rungId} phase="before" photos={group.before} onOpen={setLightboxPhoto} />
                              )}
                              {group.after.length > 0 && (
                                <PhasePanel rungId={rungId} phase="after" photos={group.after} onOpen={setLightboxPhoto} />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex items-center justify-end px-5 py-3.5 border-t border-border shrink-0">
                  <button
                    onClick={onClose}
                    className="px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </CivilWorkDprShell>
          </div>
        </div>,
        document.body,
      )}
      {lightboxPhoto && (
        <PhotoLightbox
          rungId={rungId}
          photo={lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          onDeleted={refresh}
        />
      )}
    </>
  );
}
