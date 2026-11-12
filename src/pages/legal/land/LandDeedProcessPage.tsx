import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentText } from "iconsax-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getDeedProcessLands, updateDeedProcess, approveDeedProcess, type DeedProcessLand } from "@/api/legalLandApi";
import { askLegal } from "@/components/legal/LegalAsk";
import { uploadLegalFile, openLegalFile } from "@/api/legalMastersApi";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { ExternalLink, Upload } from "lucide-react";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const today = new Date().toISOString().slice(0, 10);
const daysLeft = (d: string) => Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86_400_000);

/** The deed department's list: verified lands with the timeline the verifier set. */
export default function LandDeedProcessPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-deed-process"], queryFn: getDeedProcessLands });
  const [editing, setEditing] = useState<{ id: number; date: string } | null>(null);

  const save = async (l: DeedProcessLand, body: { targetDate?: string; completed?: boolean; deedFileId?: number | null }) => {
    try {
      toast.success((await updateDeedProcess(l.LandId, body)).message);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
      qc.invalidateQueries({ queryKey: ["legal-land-final", l.LandId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const lands = data?.lands ?? [];
  const act = async (l: DeedProcessLand, level: 1 | 2, action: "Approve" | "Reject" | "Hold") => {
    let remarks: string | undefined;
    // Every decision carries remarks (Approve too); Hold / Reject give the reason.
    const r = await askLegal({
      title: `${action === "Approve" ? `L${level} approve` : action} ${l.LandCode}${action === "Approve" ? "" : ` at L${level}`}?`,
      message: action === "Approve" ? (level === 2 ? "The land moves to Deed Registration." : "It then waits for L2 approval.") : undefined,
      input: { label: action === "Approve" ? "Approval remarks" : "Reason", required: true, multiline: true }, confirmText: action,
    });
    if (r == null) return;
    remarks = r;
    try {
      toast.success((await approveDeedProcess(l.LandId, level, action, remarks)).message);
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
      qc.invalidateQueries({ queryKey: ["legal-deed-registration"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const [uploading, setUploading] = useState<number | null>(null);
  const upload = (l: DeedProcessLand) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { toast.error("File is larger than 15 MB"); return; }
      setUploading(l.LandId);
      try { await save(l, { deedFileId: (await uploadLegalFile(f)).id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); } finally { setUploading(null); }
    };
    input.click();
  };
  const overdueCount = lands.filter((l) => l.WorkflowStatus === "Deed Process" && l.DeedTargetDate && l.DeedTargetDate < today).length;
  const small = "border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-primary/10";

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Deed Process" }]} />
      <LegalShell title="Deed Process" subtitle="Verified lands for the deed department, with the timeline set by the verifier." icon={DocumentText}>
        {overdueCount > 0 && (
          <p className="mb-3 border border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {overdueCount} land{overdueCount > 1 ? "s are" : " is"} past the deed timeline.
          </p>
        )}
        {error ? <p className="p-6 text-destructive">{(error as Error).message}</p> : isLoading ? <p className="p-6 text-muted-foreground">Loading…</p> : !lands.length ? (
          <p className="border border-border p-6 text-sm text-muted-foreground">No land in Deed Process yet. A land comes here after its Final verification (end of the Land page).</p>
        ) : (
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-3 py-2">Land ID</th><th className="px-3 py-2">Land</th><th className="px-3 py-2">Mouza · District</th><th className="px-3 py-2">Verified</th><th className="px-3 py-2">Timeline</th><th className="px-3 py-2">Deed copy</th><th className="px-3 py-2">Approval</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {lands.map((l) => {
                  const done = l.WorkflowStatus === "Deed Completed";
                  const left = l.DeedTargetDate ? daysLeft(l.DeedTargetDate) : null;
                  return (
                    <tr key={l.LandId} title="Open all details" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input, a, [role=dialog]")) navigate(`/legal/land/deed-process/${l.LandId}`); }}
                      className={`cursor-pointer border-t border-border align-top hover:bg-muted/40 ${!done && left != null && left < 0 ? "bg-destructive/10" : ""}`}>
                      <td className="px-3 py-2 font-mono font-semibold">{l.LandCode}</td>
                      <td className="px-3 py-2">{l.LandName}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{[l.MouzaName, l.DistrictName].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-2 text-xs">{fmt(l.FinalVerifiedAt)}{l.VerifiedBy ? <span className="block text-muted-foreground">{l.VerifiedBy}</span> : null}</td>
                      <td className="px-3 py-2 text-xs">
                        {editing?.id === l.LandId ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <input type="date" value={editing.date} onChange={(e) => setEditing({ id: l.LandId, date: e.target.value })} className="border border-border bg-background px-1.5 py-1 text-xs" />
                            <button className={small} disabled={!editing.date} onClick={() => save(l, { targetDate: editing.date })}>Save</button>
                            <button className="text-xs underline" onClick={() => setEditing(null)}>Cancel</button>
                          </span>
                        ) : (
                          <>
                            {fmt(l.DeedTargetDate)}
                            {!done && left != null && <span className={`block ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}>{left < 0 ? `${-left} days overdue` : left === 0 ? "due today" : `${left} days left`}</span>}
                            {!done && data?.canEditTimeline && <button className="mt-1 block text-xs underline" onClick={() => setEditing({ id: l.LandId, date: l.DeedTargetDate ?? "" })}>Change</button>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {l.DeedFileId ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <LegalFileLink id={l.DeedFileId} name={l.DeedFileName ?? "Deed copy"} />
                            <button title="Open full page in a new tab" aria-label="Open in new tab" className="text-muted-foreground hover:text-foreground" onClick={() => openLegalFile(l.DeedFileId!)}><ExternalLink size={14} /></button>
                            {canEdit && <button className="text-xs underline" disabled={uploading === l.LandId} onClick={() => upload(l)}>Replace</button>}
                          </span>
                        ) : canEdit ? (
                          <button className={`${small} inline-flex items-center gap-1`} disabled={uploading === l.LandId} onClick={() => upload(l)}><Upload size={12} /> {uploading === l.LandId ? "Uploading…" : "Upload deed"}</button>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {l.DeedChangedAt ? <b className="block text-amber-600">Re-verification Required{l.DeedChangedByName ? ` (changed by ${l.DeedChangedByName})` : ""}</b> : null}
                        <span className="block">L1: <b className={l.L1Status === "Approved" ? "text-emerald-600" : l.L1Status === "Rejected" ? "text-destructive" : l.L1Status === "On Hold" ? "text-amber-600" : ""}>{l.L1Status ?? "Pending"}</b>{l.L1By && l.L1Status !== "Pending" ? ` · ${l.L1By}` : ""}</span>
                        <span className="block">L2: <b className={l.L2Status === "Rejected" ? "text-destructive" : l.L2Status === "On Hold" ? "text-amber-600" : ""}>{l.L2Status ?? "Pending"}</b></span>
                        {(l.L1Status === "Rejected" || l.L1Status === "On Hold" || l.L2Status === "Rejected" || l.L2Status === "On Hold") && l.DeedApprovalNote && <span className="block text-muted-foreground">“{l.DeedApprovalNote}”</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1.5">
                          {data?.canL1 && l.L1Status !== "Approved" && <>
                            <button className={`${small} bg-foreground text-card disabled:cursor-not-allowed disabled:opacity-40`} disabled={!l.DeedFileId || !!l.DeedChangedAt}
                              title={!l.DeedFileId ? "Upload the deed copy first" : l.DeedChangedAt ? "Changed after verification — re-verify first" : undefined} onClick={() => act(l, 1, "Approve")}>L1 Approve</button>
                            {l.L1Status !== "On Hold" && <button className={small} onClick={() => act(l, 1, "Hold")}>Hold</button>}
                            <button className={`${small} text-destructive`} onClick={() => act(l, 1, "Reject")}>Reject</button>
                          </>}
                          {data?.canL2 && l.L1Status === "Approved" && <>
                            <button className={`${small} bg-foreground text-card disabled:cursor-not-allowed disabled:opacity-40`} disabled={!!l.DeedChangedAt} onClick={() => act(l, 2, "Approve")}>L2 Approve</button>
                            {l.L2Status !== "On Hold" && <button className={small} onClick={() => act(l, 2, "Hold")}>Hold</button>}
                            <button className={`${small} text-destructive`} onClick={() => act(l, 2, "Reject")}>Reject</button>
                          </>}
                          {!data?.canL1 && !data?.canL2 && <span className="text-xs text-muted-foreground">{l.L1Status === "Approved" ? "Waiting for L2" : "Waiting for L1"}</span>}
                        </span>
                        {/* Why approval is not open yet (shown, not only on hover). */}
                        {(data?.canL1 || data?.canL2) && l.L1Status !== "Approved" && !l.DeedFileId && <span className="mt-1 block text-[0.6875rem] text-amber-600">Upload the deed copy to approve</span>}
                        {(data?.canL1 || data?.canL2) && l.DeedChangedAt && <span className="mt-1 block text-[0.6875rem] text-amber-600">Re-verify the changes to approve</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </LegalShell>
    </>
  );
}
