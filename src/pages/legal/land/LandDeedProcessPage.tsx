import { usePaged } from "@/components/legal/usePaged";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentText } from "iconsax-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getDeedProcessLands, updateDeedProcess, approveDeedProcess, requestDeedApproval, type DeedProcessLand } from "@/api/legalLandApi";
import { askLegal } from "@/components/legal/LegalAsk";
import { uploadLegalFile, openLegalFile, getLegalLookup } from "@/api/legalMastersApi";
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
  const users = useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user"), staleTime: 600_000 });
  const list = usePaged(["legal-deed-process"], (qs) => getDeedProcessLands(qs));
  const { data, isLoading, error } = list;
  const [editing, setEditing] = useState<{ id: number; date: string } | null>(null);

  const save = async (l: DeedProcessLand, body: { targetDate?: string; completed?: boolean; deedFileId?: number | null; deedStage?: string | null; drafterId?: number | null }) => {
    try {
      toast.success((await updateDeedProcess(l.LandId, body)).message);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
      qc.invalidateQueries({ queryKey: ["legal-land-final", l.LandId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const lands = data?.lands ?? []; // one page, already limited to the picked project on the server
  const act = async (l: DeedProcessLand, action: "Approve" | "Reject" | "Hold") => {
    let remarks: string | undefined;
    // Every decision carries remarks (Approve too); Hold / Reject give the reason.
    const r = await askLegal({
      title: `${action} ${l.LandCode}?`,
      message: action === "Approve" ? "The land moves to Deed Registration." : undefined,
      input: { label: action === "Approve" ? "Approval remarks" : "Reason", required: true, multiline: true }, confirmText: action,
    });
    if (r == null) return;
    remarks = r;
    try {
      toast.success((await approveDeedProcess(l.LandId, action, remarks)).message);
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
      qc.invalidateQueries({ queryKey: ["legal-deed-registration"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const askFinal = async (l: DeedProcessLand) => {
    const ok = await askLegal({ title: `Send ${l.LandCode} for final approval?`, message: "All deed details are complete. It goes to Approvals → Deed approval.", confirmText: "Send" });
    if (ok == null) return;
    try {
      toast.success((await requestDeedApproval(l.LandId)).message);
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not send"); }
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
      <LegalShell stage="deed" title="Deed Process" subtitle="Verified lands for the deed department, with the timeline set by the verifier." icon={DocumentText}>
        {overdueCount > 0 && (
          <p className="mb-3 border border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {overdueCount} land{overdueCount > 1 ? "s are" : " is"} past the deed timeline.
          </p>
        )}
        {list.search("Search land ID, name, mouza…")}
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
                        {l.WorkflowStatus === "Deed Process" && (canEdit ? (
                          <span className="mb-1 flex flex-col gap-1">
                            <select aria-label="Deed stage" className="border border-border bg-background px-1 py-0.5 text-xs" value={l.DeedApprovalRequestedAt ? "Submitted" : l.DeedStage ?? "Not Started"}
                              disabled={!!l.DeedApprovalRequestedAt} onChange={(e) => save(l, { deedStage: e.target.value, drafterId: l.DeedDrafterId ?? null })}>
                              {l.DeedApprovalRequestedAt ? <option>Submitted</option> : (data?.deedStages ?? ["Not Started"]).map((st) => <option key={st}>{st}</option>)}
                            </select>
                            <select aria-label="Drafting by" className="border border-border bg-background px-1 py-0.5 text-xs" value={l.DeedDrafterId ?? ""}
                              onChange={(e) => save(l, { deedStage: l.DeedStage ?? null, drafterId: e.target.value ? Number(e.target.value) : null })}>
                              <option value="">Drafting by…</option>{(users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                            </select>
                          </span>
                        ) : <span className="mb-1 block">Stage: <b>{l.DeedApprovalRequestedAt ? "Submitted" : l.DeedStage ?? "Not Started"}</b>{l.DeedDrafterName ? ` · ${l.DeedDrafterName}` : ""}</span>)}
                        {l.DeedChangedAt ? <b className="block text-amber-600">Changed — new version needed{l.DeedChangedByName ? ` (changed by ${l.DeedChangedByName})` : ""}</b> : null}
                        {l.DeedApprovalRequestedAt && l.L2Status !== "Approved" && <span className="block text-sky-700 dark:text-sky-400">Sent for final approval{l.DeedApprovalRequestedByName ? ` by ${l.DeedApprovalRequestedByName}` : ""}</span>}
                        <span className="block">Approval: <b className={l.L2Status === "Approved" ? "text-emerald-600" : l.L1Status === "Rejected" ? "text-destructive" : l.L1Status === "On Hold" ? "text-amber-600" : ""}>{l.L2Status === "Approved" ? "Approved" : l.L1Status ?? "Pending"}</b>{l.L1By && l.L1Status !== "Pending" ? ` · ${l.L1By}` : ""}</span>
                        {(l.L1Status === "Rejected" || l.L1Status === "On Hold" || l.L2Status === "Rejected" || l.L2Status === "On Hold") && l.DeedApprovalNote && <span className="block text-muted-foreground">“{l.DeedApprovalNote}”</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1.5">
                          {/* Deed team: finish the deed details, then send for final approval (→ Approvals → Deed approval). */}
                          {l.WorkflowStatus === "Deed Process" && l.L2Status !== "Approved" && !l.DeedApprovalRequestedAt && (data?.canRequest
                            ? <button className={`${small} bg-foreground text-card disabled:cursor-not-allowed disabled:opacity-40`} disabled={!l.DeedFileId || !!l.DeedChangedAt}
                                title={!l.DeedFileId ? "Upload the deed copy first" : l.DeedChangedAt ? "Changed — get the new version verified and approved first" : undefined} onClick={() => askFinal(l)}>Submit for final approval</button>
                            : <span className="text-xs text-muted-foreground">Deed work in progress</span>)}
                          {l.WorkflowStatus === "Deed Process" && l.L2Status !== "Approved" && l.DeedApprovalRequestedAt && <>
                            {data?.canApprove ? <>
                              <button className={`${small} bg-foreground text-card disabled:cursor-not-allowed disabled:opacity-40`} disabled={!!l.DeedChangedAt} onClick={() => act(l, "Approve")}>Approve</button>
                              {l.L1Status !== "On Hold" && <button className={small} onClick={() => act(l, "Hold")}>Hold</button>}
                              <button className={`${small} text-destructive`} onClick={() => act(l, "Reject")}>Reject</button>
                            </> : <span className="text-xs text-muted-foreground">Waiting for final approval</span>}
                          </>}
                        </span>
                        {/* Why approval is not open yet (shown, not only on hover). */}
                        {data?.canRequest && !l.DeedApprovalRequestedAt && l.L2Status !== "Approved" && !l.DeedFileId && <span className="mt-1 block text-[0.6875rem] text-amber-600">Upload the deed copy to approve</span>}
                        {l.DeedChangedAt && <span className="mt-1 block text-[0.6875rem] text-amber-600">Changed — submit the changes for verification; the new version must be approved first</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.pager}
      </LegalShell>
    </>
  );
}
