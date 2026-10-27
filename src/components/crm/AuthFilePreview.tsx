// In-page file preview for files served by the API. A plain <a href> or
// <img src> to an API file carries no sign-in, so the server answers 401 —
// "Open" landed on an error tab and image thumbnails stayed blank. These
// fetch the file with the signed-in fetch and show it from a local blob URL.
import React, { useEffect, useState } from "react";
import { Download, FileText, Loader2, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

/** A blob URL for an API file, fetched with the sign-in; null while loading or on failure. */
export function useAuthBlobUrl(url: string | null): { blobUrl: string | null; failed: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setBlobUrl(null);
    setFailed(false);
    if (!url) return;
    let objectUrl: string | null = null;
    let alive = true;
    fetchWithAuth(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (alive) setBlobUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return { blobUrl, failed };
}

/** Small square thumbnail of an API image. */
export function AuthThumb({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const { blobUrl } = useAuthBlobUrl(url);
  return blobUrl
    ? <img src={blobUrl} alt={alt} className={className} />
    : <div className={`${className || ""} bg-muted animate-pulse`} />;
}

/** A preview card on the page: PDF / image shown inline, anything else offered as a download. */
export function FilePreviewCard({ url, fileName, mimeType, meta, onClose }: {
  url: string; fileName: string; mimeType?: string | null; meta?: string; onClose: () => void;
}) {
  const { blobUrl, failed } = useAuthBlobUrl(url);
  const isImage = !!mimeType?.startsWith("image/");
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <div className="min-w-0 flex items-center gap-2">
          <FileText size={14} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate">{fileName}</span>
          {meta && <span className="text-[0.6875rem] text-muted-foreground shrink-0">{meta}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {blobUrl && (
            <a href={blobUrl} download={fileName}
              className="text-xs px-2 py-1 rounded-md text-primary hover:bg-muted flex items-center gap-1">
              <Download size={12} /> Download
            </a>
          )}
          <button onClick={onClose} aria-label="Close preview"
            className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-center min-h-[200px] bg-muted/20">
        {failed ? (
          <p className="text-sm text-muted-foreground py-8">This file couldn't be loaded.</p>
        ) : !blobUrl ? (
          <span className="text-sm text-muted-foreground flex items-center gap-2 py-8"><Loader2 size={14} className="animate-spin" /> Loading preview…</span>
        ) : isImage ? (
          <img src={blobUrl} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
        ) : isPdf ? (
          <iframe src={blobUrl} title={fileName} className="w-full h-[60vh] border-0" />
        ) : (
          <div className="py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
            No preview for this file type.
            <a href={blobUrl} download={fileName} className="text-primary hover:underline flex items-center gap-1"><Download size={12} /> Download {fileName}</a>
          </div>
        )}
      </div>
    </div>
  );
}

/** Download an API file with the sign-in (a plain <a href download> to the API gets 401). */
export async function downloadAuthFile(url: string, fileName: string): Promise<boolean> {
  try {
    const r = await fetchWithAuth(url);
    if (!r.ok) return false;
    const blobUrl = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    return true;
  } catch {
    return false;
  }
}
