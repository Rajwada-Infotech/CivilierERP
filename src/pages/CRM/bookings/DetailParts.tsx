// Standalone parts of the booking card: the extra-work GST preview, the PDF preview dialog, and the parking
// verification checklist (Parking & Extra Charges tab).
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { KEY_INK } from "./config";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, Download, Check, ClipboardCheck, ShieldCheck, AlertTriangle, RefreshCw, X } from "lucide-react";
import { useGstRates, computeExtraWorkGst, fmtInr } from "@/lib/crmGst";

// Live "what will this actually cost" preview for the Extra Charge add
// form — 18% is fixed from the HSN Master "Extra Charges" row (useGstRates
// fetches it live, never hardcoded), matching exactly what the backend will
// charge once submitted.
export function ExtraWorkGstPreview({ amount }: { amount: number }) {
  const { data: rates, isLoading } = useGstRates();
  if (isLoading || !rates) return null;
  const gst = computeExtraWorkGst(amount, rates);
  return (
    <div className="flex items-center justify-between border border-foreground/30 bg-card px-3 py-2 text-xs text-foreground">
      <span>GST ({gst.rate}%, fixed — HSN Master)</span>
      <span className="font-semibold">{fmtInr(gst.gstAmount)} → Total {fmtInr(gst.total)}</span>
    </div>
  );
}

// Auth here is a bearer token via fetchWithAuth, same reason the Customer
// Portal's own invoice/document previews (PortalAgreement.tsx) fetch as a
// blob rather than using a plain <a href> — a raw link can't carry the
// Authorization header, so the PDF has to come through fetchWithAuth first.
export function PdfPreviewDialog({ pdfUrl, title, subtitle, filename, onClose }: {
  pdfUrl: string; title: string; subtitle?: string; filename: string; onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoadError(null);
    setBlobUrl(null);
    fetchWithAuth(pdfUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load PDF (${r.status})`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e?.message || "Failed to load PDF");
      });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [pdfUrl]);

  return createPortal(
    <div data-overlay-portal className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      style={{ pointerEvents: "auto" }}
      onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div className="bg-background border border-border shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-primary shrink-0" />
              <span className="font-medium text-sm truncate">{title}</span>
            </div>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {blobUrl && (
              <a href={blobUrl} download={filename}
                className="px-3 py-1.5 text-sm border border-border font-medium hover:bg-muted flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
            <button onClick={onClose} className="p-1 hover:bg-muted text-muted-foreground"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center min-h-[300px] bg-muted/20 overflow-hidden">
          {loadError
            ? <span className="text-sm text-destructive flex items-center gap-2"><AlertTriangle size={14} /> {loadError}</span>
            : !blobUrl
              ? <span className="text-sm text-muted-foreground flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading preview…</span>
              : <iframe src={blobUrl} title={title} className="w-full h-[65vh] border-0" />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Verification checklist helpers for Parking & Extra Charges tab ─────────
// Lightweight inline version of the welcome-call ChecklistItemRow / Section
// block, scoped to just the Parking and ExtraCharges sections. The full
// checklist with Submit/Reopen controls remains on the Welcome Call page;
// here staff can tick/untick those two items without navigating away.

export const VC_API = "/api/crm/welcome-checklist";

export function ParkingVcItem({
  item, bookingId, locked, onChanged,
}: { item: any; bookingId: number; locked: boolean; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [showRemarks, setShowRemarks] = useState(false);
  const [remarks, setRemarks] = useState(item.Remarks || "");
  const isOpenRecheck = item.RecheckStatus === "Open";

  const toggle = async () => {
    if (locked || isOpenRecheck || saving) return;
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: !item.IsChecked, Remarks: remarks }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Save failed");
      onChanged();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setSaving(false); }
  };

  const saveRemarks = async () => {
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: item.IsChecked, Remarks: remarks }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Save failed");
      toast.success("Remarks saved");
      setShowRemarks(false);
      onChanged();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        {locked ? (
          item.IsChecked
            ? <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check size={10} strokeWidth={3} /></span>
            : <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 border-dashed border-border" />
        ) : (
          <input type="checkbox" checked={!!item.IsChecked} disabled={saving || isOpenRecheck}
            onChange={toggle}
            className="shrink-0 mt-0.5 w-4 h-4 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" />
        )}
        <div className="flex-1 min-w-0">
          <span className={`text-xs leading-snug ${item.IsChecked ? "text-foreground" : "text-muted-foreground"}`}>{item.Label}</span>
          {isOpenRecheck && (
            <span className="ml-1.5 text-[0.625rem] px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400">Recheck pending</span>
          )}
          {item.Remarks && !showRemarks && (
            <p className="text-[0.625rem] text-muted-foreground mt-0.5 italic truncate">"{item.Remarks}"</p>
          )}
        </div>
        {!locked && (
          <button onClick={() => setShowRemarks((v) => !v)}
            className="shrink-0 text-[0.625rem] text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            {showRemarks ? "✕" : "note"}
          </button>
        )}
      </div>
      {showRemarks && (
        <div className="flex gap-1.5 ml-6">
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add a remark…"
            className="flex-1 text-xs border border-border px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          <button onClick={saveRemarks} disabled={saving}
            className={`${KEY_INK} h-8 px-3`}>Save</button>
        </div>
      )}
    </div>
  );
}

export function ParkingVcSection({
  vc, sectionKey, bookingId, onChanged,
}: { vc: any; sectionKey: string; bookingId: number; onChanged: () => void }) {
  if (!vc) return null;
  const sec = (vc.sections as any[])?.find((s: any) => s.section === sectionKey);
  if (!sec) return null;
  const locked = !!vc.submission?.IsLocked;
  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ClipboardCheck size={12} className="text-primary" /> Verify: {sec.label}
        </h4>
        {sec.complete && (
          <span className="flex items-center gap-1 text-[0.625rem] font-medium text-emerald-700 dark:text-emerald-400">
            <ShieldCheck size={11} /> Confirmed
          </span>
        )}
      </div>
      <div className="space-y-2">
        {(sec.items as any[]).map((item: any) => (
          <ParkingVcItem key={item.ItemKey} item={item} bookingId={bookingId} locked={locked} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
