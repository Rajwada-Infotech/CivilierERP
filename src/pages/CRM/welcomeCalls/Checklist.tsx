// The verification checklist: per-item tick, remarks, recheck and resolve, inline ticks under the fields they cover,
// the progress bar, sections and the submit / reopen footer.
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileCheck, Check, ClipboardCheck, Lock, ShieldCheck, ShieldAlert, RotateCcw, ClipboardList, Send, Unlock } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { API, VC_API, KEY_INK, type VcItem, fetchVerificationChecklist } from "./config";

// Shared checkbox rendering for every checklist item (InlineVerify and
// ChecklistItemRow both use it). Once a checklist is Submitted and locked,
// the item stays permanently disabled — but a disabled native checkbox at
// 14px with 50% opacity renders as a barely-visible grey smudge, so a fully
// verified, locked checklist visually looked almost identical to an
// unchecked one. Locked state gets its own always-legible badge instead of
// a dimmed native input; only the still-editable state uses a real checkbox.
export const VerifyCheckbox: React.FC<{
  checked: boolean; locked: boolean; disabled?: boolean; onChange: () => void;
}> = ({ checked, locked, disabled, onChange }) => {
  if (locked) {
    return checked ? (
      <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center">
        <Check size={11} strokeWidth={3} />
      </span>
    ) : (
      <span className="shrink-0 w-4 h-4 rounded-full border-2 border-dashed border-border" />
    );
  }
  return (
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange}
      className="shrink-0 w-4 h-4 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" />
  );
};

// ─── Verification Checklist — every mandatory item across every section,
// ticked and saved one at a time, with a remarks field and a "Send for
// Recheck" escape hatch for anything that doesn't match what the customer
// says. This is the actual substance of the rebuilt page: nothing here is
// derived/computed, it's explicit staff sign-off per fact. ──────────────────
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

  // Ticking the box saves immediately — same pattern as InlineVerify on the
  // Overview tab. This used to be local-only state with a separate "Save"
  // button rendered right underneath the checkbox: two clicks to record one
  // fact, and a checkbox that visibly LOOKED ticked yet silently hadn't been
  // saved until that second click was found — the exact inconsistency this
  // page's other tabs never had. Every checklist item now behaves the same
  // way everywhere it appears.
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
      if (!res.ok) throw new Error(data.error || "Failed to flag for recheck");
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
      if (!res.ok) throw new Error(data.error || "Failed to resolve");
      toast.success("Recheck resolved — please re-verify and tick the item");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <div className={`border p-2.5 space-y-1.5 ${
      isOpenRecheck ? "border-destructive/40 bg-red-50/50" : item.IsChecked ? "border-emerald-200 bg-emerald-50/30" : "border-border"
    }`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <VerifyCheckbox checked={item.IsChecked} locked={locked} disabled={isOpenRecheck || saving || !rights.canEdit} onChange={handleToggleChecked} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm ${item.IsChecked ? "text-foreground" : "text-foreground/90"}`}>{item.Label}</span>
            {isOpenRecheck ? (
              <span className="shrink-0 flex items-center gap-1 text-[0.625rem] font-medium text-destructive bg-destructive/5 border border-destructive/40 rounded-full px-2 py-0.5">
                <ShieldAlert size={10} /> Recheck Open
              </span>
            ) : item.IsChecked ? (
              <span className="shrink-0 flex items-center gap-1 text-[0.625rem] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <ShieldCheck size={10} /> Verified
              </span>
            ) : null}
          </div>

          {isOpenRecheck ? (
            <div className="mt-1 text-[0.6875rem] text-destructive space-y-1">
              <div><span className="font-medium">Flagged:</span> {item.RecheckReason}</div>
              {!locked && rights.canEdit && (
                <button type="button" onClick={handleResolve}
                  className="flex items-center gap-1 text-[0.6875rem] font-medium text-destructive hover:underline">
                  <RotateCcw size={11} /> Mark resolved (issue fixed)
                </button>
              )}
            </div>
          ) : (
            <>
              {!locked && rights.canEdit && (
                <div className="flex items-center gap-3 mt-1">
                  <button type="button" onClick={() => setShowRemarksBox((v) => !v)}
                    className="text-[0.6875rem] text-muted-foreground hover:text-primary hover:underline">
                    {showRemarksBox ? "Hide" : remarks ? "Remarks noted · edit" : "Remarks"}
                  </button>
                  <button type="button" onClick={() => setShowRecheckBox((v) => !v)}
                    className="text-[0.6875rem] font-medium text-destructive hover:underline flex items-center gap-1">
                    <Send size={11} /> Send for Recheck
                  </button>
                </div>
              )}
              {locked && remarks && <p className="mt-1 text-[0.6875rem] text-muted-foreground">— {remarks}</p>}

              {showRemarksBox && !locked && rights.canEdit && (
                <div className="mt-1.5 space-y-1">
                  <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Remarks (optional) — anything noted while confirming this with the customer"
                    rows={2} className="w-full text-xs border border-border px-2 py-1 bg-background resize-none" />
                  <button type="button" onClick={handleSaveRemarks} disabled={saving || remarks === (item.Remarks || "")}
                    className={`${KEY_INK} h-8 px-3`}>
                    {saving ? "Saving..." : "Save Remarks"}
                  </button>
                </div>
              )}

              {showRecheckBox && !locked && rights.canEdit && (
                <div className="mt-1.5 space-y-1">
                  <textarea value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)}
                    placeholder="What doesn't match / what's the conflict with the customer's data..."
                    rows={2} className="w-full text-xs border border-destructive/40 px-2 py-1.5 bg-background resize-none" />
                  <button type="button" onClick={handleSendRecheck} disabled={flagging || !recheckReason.trim()}
                    className="text-[0.6875rem] font-medium px-2 py-1 bg-red-500 text-white disabled:opacity-40 hover:bg-red-600">
                    {flagging ? "Sending..." : "Confirm — flag for recheck"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Inline verify — the mandatory tick sits directly under the field it
// confirms (Name/Mobile/Project/Bank Account/...), not in a separate list
// further down the page. This is the point: while the telecaller is
// reading a field out loud to the customer, the tick for that exact fact
// is right there to hit immediately, not scrolled away in a block of 7
// other unrelated items. Remarks and the recheck reason both start
// collapsed behind "Remarks" / "Flag for Recheck" — a call in progress
// doesn't need an empty textarea taking up space under every single field
// until there's actually something to write. Same API calls as
// ChecklistItemRow, just laid out for this purpose. ──────────────────────
export const InlineVerify: React.FC<{
  item: VcItem | undefined; bookingId: number; locked: boolean; onChanged: () => void;
  // Short, distinguishing label shown before "Verify"/"Verified" — required
  // wherever more than one InlineVerify can appear inside the same card
  // (e.g. Payment Plan's "Plan structure" + "Milestone dates"), which
  // otherwise render as two identical, unlabeled "Verified" rows with no
  // way to tell what each one actually confirms.
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
      if (!res.ok) throw new Error(data.error || "Failed to flag for recheck");
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
      if (!res.ok) throw new Error(data.error || "Failed to resolve");
      toast.success("Recheck resolved — please re-verify and tick the item");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  if (isOpenRecheck) {
    return (
      <div className="mt-1 flex items-start gap-1.5 text-[0.6875rem] text-destructive bg-red-50/50 border border-destructive/40 px-2 py-1">
        <ShieldAlert size={12} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="font-medium">Flagged:</span> {item.RecheckReason}
          {!locked && rights.canEdit && (
            <button type="button" onClick={handleResolve} className="ml-2 font-medium hover:underline inline-flex items-center gap-0.5">
              <RotateCcw size={10} /> Mark resolved
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
        <VerifyCheckbox checked={item.IsChecked} locked={locked} disabled={saving || !rights.canEdit} onChange={handleToggleChecked} />
        {label && <span className="text-muted-foreground">{label}</span>}
        <span className={item.IsChecked ? "text-emerald-700 font-medium" : "text-muted-foreground"}>
          {item.IsChecked ? "Verified" : "Verify"}
        </span>
      </label>
      {!locked && rights.canEdit && (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="text-[0.625rem] text-muted-foreground hover:text-primary hover:underline">
          {open ? "Hide" : item.Remarks ? "Remarks noted · edit" : "Remarks / Flag"}
        </button>
      )}
      {locked && item.Remarks && <span className="text-[0.625rem] text-muted-foreground truncate">— {item.Remarks}</span>}

      {open && !locked && rights.canEdit && (
        <div className="absolute z-10 mt-7 w-72 border border-border bg-background p-2.5 space-y-1.5">
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="Remarks (optional) — anything noted while confirming this with the customer"
            rows={2} className="w-full text-xs border border-border px-2 py-1 bg-background resize-none" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleSaveRemarks} disabled={saving || remarks === (item.Remarks || "")}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Saving..." : "Save Remarks"}
            </button>
            <button type="button" onClick={() => setShowRecheckBox((v) => !v)}
              className="text-[0.6875rem] font-medium text-destructive hover:underline flex items-center gap-1">
              <Send size={11} /> Flag for Recheck
            </button>
          </div>
          {showRecheckBox && (
            <div className="space-y-1 pt-1 border-t border-border">
              <textarea value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)}
                placeholder="What doesn't match / what's the conflict with the customer's data..."
                rows={2} className="w-full text-xs border border-destructive/40 px-2 py-1.5 bg-background resize-none" />
              <button type="button" onClick={handleSendRecheck} disabled={flagging || !recheckReason.trim()}
                className="text-[0.6875rem] font-medium px-2 py-1 bg-red-500 text-white disabled:opacity-40 hover:bg-red-600">
                {flagging ? "Sending..." : "Confirm — flag for recheck"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Verification checklist — split into composable pieces ─────────────────
// Was one monolithic component rendering all 8 sections back-to-back before
// ANY of the actual customer data (Documents, Co-Applicant, Nominee & Bank
// Details all render further down the page) — so staff hit "PAN confirmed" /
// "Bank account confirmed" checkboxes before they'd even scrolled far enough
// to see the actual PAN or account number to read out to the customer.
// useVerificationChecklist is the single shared data/mutation source (one
// fetch, one refetch keeps every section in sync); ChecklistProgressBar and
// ChecklistSubmitFooter are the non-section chrome; ChecklistSectionBlock
// renders exactly one section's items and is dropped in directly under that
// section's own data card, wherever that card actually lives on the page.
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
      if (!res.ok) throw new Error(data.error || "Failed to submit");
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
      if (!res.ok) throw new Error(data.error || "Failed to reopen");
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

// Slim, sticky-friendly progress readout — dropped in once near the top of
// the working area (not tied to any one section) so staff always know
// overall completion without needing to scroll to the very end.
export const ChecklistProgressBar: React.FC<{ vc: any; bookingId: number }> = ({ vc, bookingId }) => {
  if (!vc) return <div className="text-xs text-muted-foreground">Loading verification checklist…</div>;
  return (
    <div className="border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardList size={14} className="text-foreground" /> Verification Checklist</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{vc.checkedCount}/{vc.totalCount} verified</span>
          {vc.openRecheckCount > 0 && (
            <span className="flex items-center gap-1 font-medium text-destructive bg-destructive/5 border border-destructive/40 rounded-full px-2 py-0.5">
              <ShieldAlert size={11} /> {vc.openRecheckCount} in recheck
            </span>
          )}
          {vc.submission?.IsLocked && (
            <span className="flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              <Lock size={11} /> Locked
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// One section's worth of checklist items — dropped in directly under that
// section's own data card (e.g. sectionKey="BankNominee" right after the
// Nominee & Bank Details card) so the real value being confirmed is always
// the thing staff just looked at, never something further down the page.
export const ChecklistSectionBlock: React.FC<{
  vc: any; bookingId: number; locked: boolean; onChanged: () => void; sectionKey: string;
}> = ({ vc, bookingId, locked, onChanged, sectionKey }) => {
  if (!vc) return null;
  const s = vc.sections.find((sec: any) => sec.section === sectionKey);
  if (!s) return null;
  return (
    <div className="border border-border p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ClipboardCheck size={12} className="text-primary" /> Verify: {s.label}
        </h4>
        {s.complete && <span className="flex items-center gap-1 text-[0.625rem] font-medium text-emerald-700"><ShieldCheck size={11} /> Complete</span>}
      </div>
      <div className="space-y-1.5">
        {s.items.map((item: VcItem) => (
          <ChecklistItemRow key={item.ItemKey} item={item} bookingId={bookingId} locked={locked} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
};

// Final action bar — placed after the last section in DOM order (Nominee &
// Bank Details, currently the last data card on the page). Submitting here
// requires every section's items checked with zero open rechecks, exactly
// as the old single-block version did — this only changes where the items
// themselves render, not the gate itself.
export const ChecklistSubmitFooter: React.FC<{
  vc: any; locked: boolean; submitting: boolean; reopening: boolean;
  onSubmit: () => void; onReopen: () => void; onPreviewPdf?: () => void;
}> = ({ vc, locked, submitting, reopening, onSubmit, onReopen, onPreviewPdf }) => {
  const rights = usePageRights("crm-welcome-calls");
  if (!vc) return null;
  return (
    <div className="border border-border p-3.5 space-y-2 bg-muted/10">
      {locked ? (
        <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <span className="flex items-center gap-1.5 font-medium"><Lock size={12} /> Submitted and locked{vc.submission?.SubmittedAt ? ` — ${fmtIstIso(vc.submission.SubmittedAt)}` : ""}</span>
          <div className="flex items-center gap-3">
            {onPreviewPdf && (
              <button type="button" onClick={onPreviewPdf}
                className="flex items-center gap-1 font-medium text-emerald-700 hover:underline">
                <FileCheck size={12} /> View PDF
              </button>
            )}
            {rights.canEdit && (
              <button type="button" onClick={onReopen} disabled={reopening}
                className="flex items-center gap-1 font-medium text-emerald-700 hover:underline disabled:opacity-40">
                <Unlock size={12} /> {reopening ? "Reopening..." : "Reopen"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[0.6875rem] ${!vc.hasWelcomedCall && vc.canSubmit ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {!vc.hasWelcomedCall
              ? "Log a call with outcome \"Welcomed\" first — this checklist confirms facts checked during that call."
              : vc.canSubmit ? "All items verified — ready to submit." : "Every item must be checked, with no open rechecks, before this can be submitted."}
          </p>
          {rights.canEdit && (
            <button type="button" onClick={onSubmit} disabled={!vc.canSubmit || !vc.hasWelcomedCall || submitting}
              className="px-4 py-1.5 text-sm bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40 shrink-0">
              {submitting ? "Submitting..." : "Submit Verification"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
