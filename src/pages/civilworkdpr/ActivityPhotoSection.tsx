import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Camera, ImagePlus, Loader2, Trash2, ImageOff } from "lucide-react";
import {
  getActivityPhotos,
  getActivityPhoto,
  uploadActivityPhoto,
  deleteActivityPhoto,
  type PhotoPhase,
  type ActivityPhotoMeta,
} from "@/api/dependencyActivityAssignmentApi";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";

const PHOTO_ACCEPT = "image/*";
const PHASE_LABEL: Record<PhotoPhase, string> = { before: "Before", after: "After" };

// Opens a photo full-size in a new tab. Always through fetchWithAuth (via
// getActivityPhoto) — the app's auth is a Bearer token attached only by
// fetchWithAuth's own header, so a plain <a href> straight to the API
// 401s (same lesson learned on Room Master's blueprint viewer).
async function openPhoto(rungId: number, photoId: number) {
  try {
    const { mimeType, dataBase64 } = await getActivityPhoto(rungId, photoId);
    const byteChars = atob(dataBase64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType || "image/jpeg" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err: any) {
    toast.error(err.message || "Could not open photo");
  }
}

function PhotoThumb({ rungId, photo, onDeleted }: { rungId: number; photo: ActivityPhotoMeta; onDeleted: () => void }) {
  const [hover, setHover] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { data } = useQuery({
    queryKey: ["activity-photo", rungId, photo.id],
    queryFn: () => getActivityPhoto(rungId, photo.id),
    staleTime: 5 * 60_000,
  });

  const handleDelete = async () => {
    if (!window.confirm("Delete this photo?")) return;
    setDeleting(true);
    try {
      await deleteActivityPhoto(rungId, photo.id);
      onDeleted();
    } catch (err: any) {
      toast.error(err.message || "Could not delete photo");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="relative w-full aspect-square rounded-lg border border-border overflow-hidden bg-muted/30 group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {data ? (
        <button
          type="button"
          onClick={() => openPhoto(rungId, photo.id)}
          className="w-full h-full block"
          title={photo.fileName}
        >
          <img
            src={`data:${data.mimeType};base64,${data.dataBase64}`}
            alt={photo.fileName}
            className="w-full h-full object-cover"
          />
        </button>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {(hover || deleting) && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-destructive flex items-center justify-center transition-colors"
        >
          {deleting ? <Loader2 size={10} className="animate-spin text-white" /> : <Trash2 size={10} className="text-white" />}
        </button>
      )}
    </div>
  );
}

function PhotoColumn({
  rungId,
  phase,
  photos,
  onChanged,
}: {
  rungId: number;
  phase: PhotoPhase;
  photos: ActivityPhotoMeta[];
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadActivityPhoto(rungId, phase, file);
      }
      onChanged();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex-1 min-w-0 space-y-2">
      <p className="text-[10px] uppercase tracking-widest font-heading font-semibold text-muted-foreground">
        {PHASE_LABEL[phase]} ({photos.length})
      </p>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <PhotoThumb key={p.id} rungId={rungId} photo={p} onDeleted={onChanged} />
        ))}
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
          className="w-full aspect-square rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          <span className="text-[9px] font-medium">Add photo</span>
        </button>
      </div>
    </div>
  );
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
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["activity-photos", rungId],
    queryFn: () => getActivityPhotos(rungId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["activity-photos", rungId] });

  const before = data?.before ?? [];
  const after = data?.after ?? [];

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl overflow-hidden">
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
            <div className="flex-1 min-h-0 overflow-y-auto p-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={20} className="animate-spin text-muted-foreground" />
                </div>
              ) : before.length === 0 && after.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <ImageOff size={24} className="text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No photos yet — add a before/after shot below.</p>
                </div>
              ) : null}
              <div className="flex flex-col sm:flex-row gap-6">
                <PhotoColumn rungId={rungId} phase="before" photos={before} onChanged={refresh} />
                <PhotoColumn rungId={rungId} phase="after" photos={after} onChanged={refresh} />
              </div>
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
  );
}
