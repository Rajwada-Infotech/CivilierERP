// The verification checklist: per-item tick, remarks, recheck and resolve, inline ticks under the fields they cover,
// the progress bar, sections and the submit / reopen footer.
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Check, ClipboardCheck, FileText, Lock, RotateCcw, Send, ShieldAlert, ShieldCheck, Unlock } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { VC_API, KEY_INK, KEY_LINE, KEY_RED, TEXTAREA, TONE_EMERALD_PILL, TONE_EMERALD_TEXT, type VcItem, fetchVerificationChecklist } from "./config";

// Shared checkbox rendering for every checklist item (InlineVerify and
// ChecklistItemRow both use it). Locked state gets its own always-legible
// rounded badge instead of a dimmed native input.
export const VerifyCheckbox: React.FC<{
  checked: boolean; locked: boolean; disabled?: boolean; onChange: () => void;
}> = ({ checked, locked, disabled, onChange }) => {
  if (locked) {
    return checked ? (
      <span className="shrink-0 w-4 h-4 rounded bg-primary text-primary-foreground flex items-center justify-center">
        <Check size={11} strokeWidth={3} />
      </span>
    ) : (
      <span className="shrink-0 w-4 h-4 rounded border-2 border-dashed border-border" />
    );
  }
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="shrink-0 w-4 h-4 rounded accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
};

// ─── Verification Checklist row ─────────────────────────────────────────────
export const ChecklistItemRow: React.FC<{
  item: VcItem; bookingId: number; locked: boolean; onChanged: () => void;
}> = ({ item, bookingId, locked, onChanged }) => {
  const rights = usePageRights("crm-welcome-calls");
  const [remarks, setRemarks] = useState(item.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [recheckReason, setRecheckReason] = useState("");
  const [showRecheckBox, setShowRecheckBox] = useState(false);
  const [showRemarksBox, setShowRemarksBox] = useState(false);
  const isOpenRecheck = item.RecheckStatus === CrmStatus.OPEN;

  useEffect(() => { setRemarks(item.Remarks || ""); }, [item.Remarks]);

  const handleToggleChecked = async () => {
    if (locked || isOpenRecheck || saving) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: !item.IsChecked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRemarks = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: item.IsChecked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Remarks saved");
      setShowRemarksBox(false);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSendRecheck = async () => {
    if (!recheckReason.trim()) { toast.error("Describe the mismatch or conflict before sending for recheck"); return; }
    setFlagging(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: recheckReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not flag for recheck");
      toast.success("Sent for recheck — assigned salesperson notified");
      setRecheckReason("");
      setShowRecheckBox(false);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setFlagging(false);
    }
  };

  const handleResolve = async () => {
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/resolve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not resolve");
      toast.success("Recheck resolved — please re-verify and tick the item");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <div className={cn(
      "rounded-lg border px-3.5 py-2.5 space-y-2 transition-colors",
      isOpenRecheck
        ? "border-destructive/40 bg-destructive/5"
        : item.IsChecked
          ? "border-border bg-card"
          : "border-border/80 bg-muted/20 hover:bg-card hover:border-border",
    )}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5">
          <VerifyCheckbox checked={item.IsChecked} locked={locked} disabled={isOpenRecheck || saving || !rights.canEdit} onChange={handleToggleChecked} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-sm", item.IsChecked ? "font-medium text-foreground" : "text-foreground/90")}>{item.Label}</span>
            {isOpenRecheck ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full text-[0.6875rem] font-medium text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5">
                <ShieldAlert size={11} /> Recheck Open
              </span>
            ) : item.IsChecked ? (
              <span className={cn("shrink-0 inline-flex items-center gap-1 rounded-full border text-[0.6875rem] font-medium px-2 py-0.5", TONE_EMERALD_PILL)}>
                <ShieldCheck size={11} /> Verified
              </span>
            ) : (
              <span className="shrink-0 rounded-full text-[0.6875rem] font-medium text-muted-foreground bg-muted px-2 py-0.5">
                Pending
              </span>
            )}
          </div>

          {isOpenRecheck ? (
            <div className="mt-1.5 text-xs text-destructive space-y-1">
              <div><span className="font-semibold">Flagged:</span> {item.RecheckReason}</div>
              {!locked && rights.canEdit && (
                <button type="button" onClick={handleResolve}
                  className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline">
                  <RotateCcw size={11} /> Mark resolved (issue fixed)
                </button>
              )}
            </div>
          ) : (
            <>
              {!locked && rights.canEdit && (
                <div className="flex items-center gap-3 mt-1.5">
                  <button type="button" onClick={() => setShowRemarksBox((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-primary hover:underline">
                    {showRemarksBox ? "Hide remarks" : remarks ? "Edit remarks" : "Add remarks"}
                  </button>
                  <button type="button" onClick={() => setShowRecheckBox((v) => !v)}
                    className="text-xs font-medium text-destructive hover:underline inline-flex items-center gap-1">
                    <Send size={11} /> Send for recheck
                  </button>
                </div>
              )}
              {locked && remarks && <p className="mt-1 text-xs text-muted-foreground italic">"{remarks}"</p>}

              {showRemarksBox && !locked && rights.canEdit && (
                <div className="mt-2 space-y-1.5">
                  <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Remarks (optional) — anything noted while confirming this with the customer"
                    rows={2} className={TEXTAREA} />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleSaveRemarks} disabled={saving || remarks === (item.Remarks || "")}
                      className={`${KEY_INK} h-8 px-3`}>
                      {saving ? "Saving…" : "Save Remarks"}
                    </button>
                    <button type="button" onClick={() => setShowRemarksBox(false)} className={`${KEY_LINE} h-8 px-2.5`}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {showRecheckBox && !locked && rights.canEdit && (
                <div className="mt-2 space-y-1.5">
                  <textarea value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)}
                    placeholder="What doesn't match / what's the conflict with the customer's data…"
                    rows={2} className={cn(TEXTAREA, "border-destructive/40 focus:border-destructive focus:ring-destructive/20")} />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleSendRecheck} disabled={flagging || !recheckReason.trim()}
                      className={`${KEY_RED} h-8 px-3`}>
                      {flagging ? "Sending…" : "Flag for recheck"}
                    </button>
                    <button type="button" onClick={() => setShowRecheckBox(false)} className={`${KEY_LINE} h-8 px-2.5`}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Inline verify — sits cleanly under the field it verifies ────────────────
export const InlineVerify: React.FC<{
  item: VcItem | undefined; bookingId: number; locked: boolean; onChanged: () => void;
  label?: string;
}> = ({ item, bookingId, locked, onChanged, label }) => {
  const rights = usePageRights("crm-welcome-calls");
  const [open, setOpen] = useState(false);
  const [remarks, setRemarks] = useState(item?.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [recheckReason, setRecheckReason] = useState("");
  const [showRecheckBox, setShowRecheckBox] = useState(false);

  useEffect(() => { setRemarks(item?.Remarks || ""); }, [item?.Remarks]);

  if (!item) return null;
  const isOpenRecheck = item.RecheckStatus === CrmStatus.OPEN;

  const handleToggleChecked = async () => {
    if (locked || isOpenRecheck || saving) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: !item.IsChecked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRemarks = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: item.IsChecked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Remarks saved");
      setOpen(false);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSendRecheck = async () => {
    if (!recheckReason.trim()) { toast.error("Describe the mismatch or conflict before sending for recheck"); return; }
    setFlagging(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: recheckReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not flag for recheck");
      toast.success("Sent for recheck — assigned salesperson notified");
      setRecheckReason("");
      setShowRecheckBox(false);
      setOpen(false);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setFlagging(false);
    }
  };

  const handleResolve = async () => {
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/resolve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not resolve");
      toast.success("Recheck resolved — please re-verify and tick the item");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  if (isOpenRecheck) {
    return (
      <div className="mt-1.5 flex items-start gap-1.5 rounded-md text-[0.6875rem] text-destructive bg-destructive/5 border border-destructive/30 px-2.5 py-1.5">
        <ShieldAlert size={12} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="font-semibold">Flagged:</span> {item.RecheckReason}
          {!locked && rights.canEdit && (
            <button type="button" onClick={handleResolve} className="ml-2 font-medium hover:underline inline-flex items-center gap-0.5">
              <RotateCcw size={10} /> Resolve
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-1.5 flex items-center gap-2 flex-wrap">
      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
        <VerifyCheckbox checked={item.IsChecked} locked={locked} disabled={saving || !rights.canEdit} onChange={handleToggleChecked} />
        {label && <span className="text-muted-foreground">{label}</span>}
        <span className={cn(
          item.IsChecked ? cn(TONE_EMERALD_TEXT, "font-medium") : "text-muted-foreground",
        )}>
          {item.IsChecked ? "Verified" : "Verify"}
        </span>
      </label>
      {!locked && rights.canEdit && (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="text-[0.6875rem] text-muted-foreground hover:text-primary hover:underline">
          {open ? "Close" : item.Remarks ? "Note" : "Note / Flag"}
        </button>
      )}
      {locked && item.Remarks && (
        <span className="text-[0.6875rem] text-muted-foreground truncate max-w-[180px]" title={item.Remarks}>— {item.Remarks}</span>
      )}

      {open && !locked && rights.canEdit && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-72 rounded-lg border border-border bg-card shadow-lg p-3 space-y-2">
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="Remarks (optional) — noted while confirming with the customer"
            rows={2} className={cn(TEXTAREA, "text-xs")} />
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={handleSaveRemarks} disabled={saving || remarks === (item.Remarks || "")}
              className={`${KEY_INK} h-7 px-2.5`}>
              {saving ? "Saving…" : "Save note"}
            </button>
            <button type="button" onClick={() => setShowRecheckBox((v) => !v)}
              className="text-[0.6875rem] font-medium text-destructive hover:underline inline-flex items-center gap-1">
              <Send size={11} /> Flag mismatch
            </button>
          </div>
          {showRecheckBox && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <textarea value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)}
                placeholder="What doesn't match / what's the conflict…"
                rows={2} className={cn(TEXTAREA, "text-xs border-destructive/40 focus:border-destructive focus:ring-destructive/20")} />
              <button type="button" onClick={handleSendRecheck} disabled={flagging || !recheckReason.trim()}
                className={`${KEY_RED} h-7 px-2.5`}>
                {flagging ? "Sending…" : "Send for recheck"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Shared checklist data + mutation hook ──────────────────────────────────
export function useVerificationChecklist(bookingId: number, onAfterSubmit?: () => void) {
  const { data: vc, refetch } = useQuery({
    queryKey: ["crm-welcome-verification-checklist", bookingId],
    queryFn: () => fetchVerificationChecklist(bookingId),
  });
  const [submitting, setSubmitting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const locked = !!vc?.submission?.IsLocked;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/submit`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit");
      toast.success("Welcome call verification submitted and locked");
      await refetch();
      onAfterSubmit?.();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    setReopening(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/reopen`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not reopen");
      toast.success("Checklist reopened for edits");
      refetch();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setReopening(false);
    }
  };

  return { vc, refetch, locked, submitting, reopening, handleSubmit, handleReopen };
}

// ─── Unified Verification Banner (matches CrmBookingDetail's Data Review bar) ─
export const VerificationBanner: React.FC<{
  vc: any; locked: boolean; submitting: boolean; reopening: boolean;
  onSubmit: () => void; onReopen: () => void; onPreviewPdf?: () => void;
}> = ({ vc, locked, submitting, reopening, onSubmit, onReopen, onPreviewPdf }) => {
  const rights = usePageRights("crm-welcome-calls");
  if (!vc) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        Loading verification checklist…
      </div>
    );
  }
  const checked = Number(vc.checkedCount || 0);
  const total = Number(vc.totalCount || 0);
  const openRechecks = Number(vc.openRecheckCount || 0);
  const pct = total > 0 ? Math.min(100, Math.round((checked / total) * 100)) : 0;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-[0_2px_3px_0_hsl(var(--foreground)/0.07)] space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5">
            <ClipboardCheck size={15} className="text-primary shrink-0" />
            Verification checklist
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {checked} of {total} verified
          </span>
          {locked ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
              <Lock size={10} /> Locked{vc.submission?.SubmittedAt ? ` · ${fmtIstIso(vc.submission.SubmittedAt)}` : ""}
            </span>
          ) : openRechecks > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 border border-destructive/30 px-2.5 py-0.5 text-[0.6875rem] font-medium text-destructive">
              <ShieldAlert size={10} /> {openRechecks} in recheck
            </span>
          ) : !vc.hasWelcomedCall ? (
            <span className="text-xs text-muted-foreground">
              · Log a "Welcomed" call first to unlock submission
            </span>
          ) : vc.canSubmit ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
              <Check size={10} /> Ready to submit
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              · Verify all remaining items to submit
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {locked ? (
            <>
              {onPreviewPdf && (
                <button type="button" onClick={onPreviewPdf} className={`${KEY_LINE} h-8 px-3 text-foreground`}>
                  <FileText size={13} /> View PDF
                </button>
              )}
              {rights.canEdit && (
                <button type="button" onClick={onReopen} disabled={reopening} className={`${KEY_LINE} h-8 px-3`}>
                  <Unlock size={13} /> {reopening ? "Reopening…" : "Reopen"}
                </button>
              )}
            </>
          ) : (
            rights.canEdit && (
              <button
                type="button"
                onClick={onSubmit}
                disabled={!vc.canSubmit || !vc.hasWelcomedCall || submitting}
                className={`${KEY_INK} h-8 px-3.5`}
              >
                <ShieldCheck size={13} /> {submitting ? "Submitting…" : "Submit Verification"}
              </button>
            )
          )}
        </div>
      </div>

      <div
        className="h-1.5 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={checked}
        aria-valuemax={total}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            openRechecks > 0 ? "bg-amber-500" : locked || (total > 0 && checked === total) ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// Kept for backward compatibility if any consumer renders progress & footer separately
export const ChecklistProgressBar: React.FC<{ vc: any; bookingId: number }> = ({ vc }) => {
  if (!vc) return <div className="text-xs text-muted-foreground">Loading verification checklist…</div>;
  const checked = Number(vc.checkedCount || 0);
  const total = Number(vc.totalCount || 0);
  const pct = total > 0 ? Math.min(100, Math.round((checked / total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium flex items-center gap-1.5 text-foreground">
          <ClipboardCheck size={13} className="text-primary" /> Verification checklist — {checked} of {total} verified
        </span>
        <div className="flex items-center gap-2">
          {vc.openRecheckCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full font-medium text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5">
              <ShieldAlert size={11} /> {vc.openRecheckCount} in recheck
            </span>
          )}
          {vc.submission?.IsLocked && (
            <span className={cn("inline-flex items-center gap-1 rounded-full border font-medium px-2 py-0.5", TONE_EMERALD_PILL)}>
              <Lock size={11} /> Locked
            </span>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={checked} aria-valuemax={total}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const ChecklistSectionBlock: React.FC<{
  vc: any; bookingId: number; locked: boolean; onChanged: () => void; sectionKey: string;
}> = ({ vc, bookingId, locked, onChanged, sectionKey }) => {
  if (!vc) return null;
  const s = vc.sections.find((sec: any) => sec.section === sectionKey);
  if (!s) return null;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ClipboardCheck size={13} className="text-primary" /> Verify: {s.label}
        </h4>
        {s.complete && (
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
            <ShieldCheck size={11} /> Complete
          </span>
        )}
      </div>
      <div className="p-3.5 space-y-2">
        {s.items.map((item: VcItem) => (
          <ChecklistItemRow key={item.ItemKey} item={item} bookingId={bookingId} locked={locked} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
};

export const ChecklistSubmitFooter: React.FC<{
  vc: any; locked: boolean; submitting: boolean; reopening: boolean;
  onSubmit: () => void; onReopen: () => void; onPreviewPdf?: () => void;
}> = ({ vc, locked, submitting, reopening, onSubmit, onReopen, onPreviewPdf }) => {
  const rights = usePageRights("crm-welcome-calls");
  if (!vc) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs">
      {locked ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Lock size={12} className={TONE_EMERALD_TEXT} /> Submitted and locked{vc.submission?.SubmittedAt ? ` — ${fmtIstIso(vc.submission.SubmittedAt)}` : ""}
          </span>
          <div className="flex items-center gap-2">
            {onPreviewPdf && (
              <button type="button" onClick={onPreviewPdf} className={`${KEY_LINE} h-8 px-2.5 text-foreground`}>
                <FileText size={12} /> View PDF
              </button>
            )}
            {rights.canEdit && (
              <button type="button" onClick={onReopen} disabled={reopening} className={`${KEY_LINE} h-8 px-2.5`}>
                <Unlock size={12} /> {reopening ? "Reopening…" : "Reopen"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {!vc.hasWelcomedCall
              ? "Log a call with outcome \"Welcomed\" first — this checklist confirms facts checked during that call."
              : vc.canSubmit
                ? "All items verified — ready to submit."
                : "Every item must be checked, with no open rechecks, before this can be submitted."}
          </p>
          {rights.canEdit && (
            <button type="button" onClick={onSubmit} disabled={!vc.canSubmit || !vc.hasWelcomedCall || submitting}
              className={`${KEY_INK} h-8 px-3.5 shrink-0`}>
              {submitting ? "Submitting…" : "Submit Verification"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
