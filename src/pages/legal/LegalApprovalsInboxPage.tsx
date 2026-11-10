import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardTick } from "iconsax-react";
import { CheckCircle2, RotateCcw, XCircle, Eye, Building2, FileText } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalPendingQueue, actionDeedL1, actionDeedL2 } from "@/api/legalOperationsApi";
import { getDeedRegistrationLands, deedRegistrationAction, type DeedRegistrationLand } from "@/api/legalLandApi";
import { uploadLegalFile } from "@/api/legalMastersApi";
import { askLegal } from "@/components/legal/LegalAsk";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { RegistrySearchPanel, LandRegistrySearches } from "@/components/legal/RegistrySearchPanel";
import {
  getLandPendingQueue,
} from "@/api/legalLandApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function LegalApprovalsInboxPage({ view = "land" }: { view?: "land" | "deed" }) {
  const rights = usePageRights("legal-approvals");
  const landRights = usePageRights("legal-land-master");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // One page, two sidebar items: Pending Verification (lands) and Deed Registration (after Deed Process).
  const activeTab: "land" | "deed" = view;

  // Deed Modal Action State
  const [activeDeedItem, setActiveDeedItem] = useState<{ id: number; stage: "L1" | "L2"; fileNo: string } | null>(null);

  const [modalAction, setModalAction] = useState<"Approve" | "Return" | "Reject" | null>(null);
  const [remarks, setRemarks] = useState("");

  // Queries
  const { data: deedData, isLoading: isDeedLoading } = useQuery({
    queryKey: ["legal-pending-queue"],
    queryFn: getLegalPendingQueue,
  });

  const { data: landQueue = [], isLoading: isLandLoading } = useQuery({
    queryKey: ["legal-land-pending-queue"],
    queryFn: getLandPendingQueue,
  });

  // Deed Mutations
  const l1DeedMutation = useMutation({
    mutationFn: (payload: { id: number; action: "Approve" | "Return"; remarks: string }) =>
      actionDeedL1(payload.id, payload.action, payload.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-pending-queue"] });
      setActiveDeedItem(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const l2DeedMutation = useMutation({
    mutationFn: (payload: { id: number; action: "Approve" | "Return" | "Reject"; remarks: string }) =>
      actionDeedL2(payload.id, payload.action, payload.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-pending-queue"] });
      setActiveDeedItem(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: regData } = useQuery({ queryKey: ["legal-deed-registration"], queryFn: getDeedRegistrationLands, enabled: activeTab === "deed" });
  // An older backend answered with the plain list; accept both.
  const regLands = (Array.isArray(regData) ? regData : regData?.lands) ?? [];
  const [regBusy, setRegBusy] = useState<number | null>(null);
  // Apply (approvers only; who / when kept) → registered deed copy uploaded → Submit (land moves to Land & Projects).
  const regApply = async (l: DeedRegistrationLand) => {
    if (!(await askLegal({ title: `Apply ${l.LandCode} for deed registration?`, message: "Your name and today's date are recorded; the days open are counted from now.", confirmText: "Apply" }))) return;
    setRegBusy(l.LandId);
    try { toast.success((await deedRegistrationAction(l.LandId, "apply")).message); queryClient.invalidateQueries({ queryKey: ["legal-deed-registration"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not apply"); } finally { setRegBusy(null); }
  };
  const regSubmit = (l: DeedRegistrationLand) => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const f = el.files?.[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { toast.error("File is larger than 15 MB"); return; }
      if (!(await askLegal({ title: `Submit ${l.LandCode} as registered?`, message: `Registered deed copy: ${f.name}. The land then moves to Land & Projects.`, confirmText: "Submit" }))) return;
      setRegBusy(l.LandId);
      try {
        const up = await uploadLegalFile(f);
        toast.success((await deedRegistrationAction(l.LandId, "submit", up.id)).message);
        queryClient.invalidateQueries({ queryKey: ["legal-deed-registration"] });
      } catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit"); } finally { setRegBusy(null); }
    };
    el.click();
  };
  const deedQueue = deedData?.approvalQueue || [];

  const handleDeedActionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeedItem || !modalAction) return;

    if (activeDeedItem.stage === "L1") {
      l1DeedMutation.mutate({ id: activeDeedItem.id, action: modalAction as "Approve" | "Return", remarks });
    } else {
      l2DeedMutation.mutate({ id: activeDeedItem.id, action: modalAction, remarks });
    }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: activeTab === "deed" ? "Deed Registration" : "Pending Verification" }]} />
      <LegalShell
        title={activeTab === "deed" ? "Deed Registration" : "Pending Verification"}
        subtitle={activeTab === "deed" ? "Deed registrations after Deed Process, awaiting L1 / L2 review." : "Lands waiting for final verification (Final Verify opens every detail and document; verified land goes to Deed Process)."}
        icon={ClipboardTick}
      >
        <div className="space-y-6">
          {/* TAB 1: LAND RECORDS APPROVAL QUEUE */}
          {activeTab === "land" && (
            <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
              {isLandLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading land approval queue…</div>
              ) : landQueue.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600/60 mb-3" />
                  <h3 className="text-base font-semibold text-foreground">Land Approval Inbox is clear</h3>
                  <p className="text-xs text-muted-foreground mt-1">No land is waiting for final verification.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Land ID</th>
                        <th className="px-4 py-3">Property Title</th>
                        <th className="px-4 py-3">Current Stage</th>
                        <th className="px-4 py-3">Mouza & District</th>
                        <th className="px-4 py-3">Area</th>
                        <th className="px-4 py-3">Waiting (Days)</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {landQueue.map((item) => {

                        return (
                          <tr key={item.LandId} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-semibold text-foreground font-mono">
                              <button
                                onClick={() => navigate(`/legal/land/properties/${item.LandId}`)}
                                className="hover:underline flex items-center gap-1 text-primary"
                              >
                                {item.LandCode}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-xs font-medium text-foreground">
                              {item.LandName}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border bg-amber-500/10 text-amber-600 border-amber-500/20"
                              >
                                {item.Stage}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {item.MouzaName ? `${item.MouzaName}${item.JLNo ? ` (J.L. ${item.JLNo})` : ""}` : "—"}
                              {item.DistrictName ? ` · ${item.DistrictName}` : ""}
                            </td>
                            <td className="px-4 py-3 text-xs font-semibold text-foreground">
                              {item.Area !== null ? `${item.Area} ${item.UnitName ?? ""}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-xs font-semibold">
                              <span className={item.WaitingDays > 2 ? "text-red-600" : "text-foreground"}>
                                {item.WaitingDays} days
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs"
                                onClick={() => navigate(`/legal/land/properties/${item.LandId}`)}
                              >
                                <Eye size={12} className="mr-1" /> View
                              </Button>

                              {/* No L1/L2: the verifier checks everything on one page, then sends it to Deed Process. */}
                              {landRights.canView && (
                                <Button
                                  size="sm"
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                                  onClick={() => navigate(`/legal/land/properties/${item.LandId}/final-verify`)}
                                >
                                  Final Verify
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Search records: look a land up, check it on the government site, store the finding */}
          {activeTab === "deed" && <RegistrySearchPanel />}

          {/* Lands approved (L1 + L2) at the end of Deed Process, ready for registration */}
          {activeTab === "deed" && (
            <div className="border border-border bg-card">
              <p className="border-b border-border px-4 py-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Lands approved for deed registration · {regLands.length}</p>
              {!regLands.length ? <p className="p-4 text-sm text-muted-foreground">No land yet. A land comes here after L1 and L2 approval on the Deed Process page.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="px-3 py-2">Land ID</th><th className="px-3 py-2">Land</th><th className="px-3 py-2">Mouza (J.L.) · District</th><th className="px-3 py-2">Dag / Khatian</th><th className="px-3 py-2">Area</th><th className="px-3 py-2">Seller(s) — current owners</th><th className="px-3 py-2">Value ₹</th><th className="px-3 py-2">Timeline</th><th className="px-3 py-2">Deed copy</th><th className="px-3 py-2">Approved</th></tr>
                    </thead>
                    <tbody>
                      {regLands.map((l) => (
                        <React.Fragment key={l.LandId}>
                        <tr className="cursor-pointer border-t border-border align-top hover:bg-muted/40" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) navigate(`/legal/deed-registration/${l.LandId}`); }}>
                          <td className="px-3 py-2 font-mono font-semibold">{l.LandCode}</td>
                          <td className="px-3 py-2">{l.LandName}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{[l.MouzaName ? `${l.MouzaName}${l.JLNo ? ` (${l.JLNo})` : ""}` : null, l.DistrictName].filter(Boolean).join(" · ") || "—"}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            <span className="block">RS {l.RsDagNo ?? "—"} / {l.RsKhatianNo ?? "—"}</span>
                            <span className="block">LR {l.LrDagNo ?? "—"} / {l.LrKhatianNo ?? "—"}</span>
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{l.Area != null ? `${l.Area} ${l.UnitName ?? ""}` : "—"}</td>
                          <td className="px-3 py-2 text-xs">{l.Owners ?? "—"}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            <span className="block">Govt {l.GovtValue != null ? Number(l.GovtValue).toLocaleString("en-IN") : "—"}</span>
                            <span className="block text-muted-foreground">Market {l.MarketValue != null ? Number(l.MarketValue).toLocaleString("en-IN") : "—"}</span>
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{l.DeedTargetDate ? new Date(l.DeedTargetDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                          <td className="px-3 py-2 text-xs">{l.DeedFileId ? <LegalFileLink id={l.DeedFileId} name={l.DeedFileName ?? "Deed copy"} /> : "—"}</td>
                          <td className="px-3 py-2 text-xs">{l.L2ApprovedAt ? new Date(l.L2ApprovedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}<span className="block text-muted-foreground">L1 {l.L1By ?? "—"} · L2 {l.L2By ?? "—"}</span></td>
                        </tr>
                        {/* Record searches saved for this land (Search records panel above) */}
                        <tr className="bg-muted/20">
                          <td colSpan={11} className="px-6 pb-3 pt-1">
                            {/* Registration: apply (approvers) → days open → upload the registered deed and submit */}
                            <div className="mb-2 flex flex-wrap items-center gap-3 border-b border-border/60 pb-2 text-xs">
                              <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Registration</span>
                              {l.RegAppliedAt ? (
                                <>
                                  <span>Applied {new Date(l.RegAppliedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}{l.RegAppliedByName ? ` by ${l.RegAppliedByName}` : ""}</span>
                                  <b className={(l.RegDaysOpen ?? 0) > 30 ? "text-destructive" : "text-amber-600"}>{l.RegDaysOpen ?? 0} day{l.RegDaysOpen === 1 ? "" : "s"} open</b>
                                  {regData && !Array.isArray(regData) && regData.canApply && <button className="border border-foreground bg-foreground px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-40" disabled={regBusy === l.LandId} onClick={() => regSubmit(l)}>Upload registered deed & submit</button>}
                                </>
                              ) : regData && !Array.isArray(regData) && regData.canApply ? (
                                <button className="border border-foreground bg-foreground px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-40" disabled={regBusy === l.LandId} onClick={() => regApply(l)}>Apply to deed register</button>
                              ) : <span className="text-muted-foreground">Not applied yet — an approver applies</span>}
                            </div>
                            <LandRegistrySearches landId={l.LandId} />
                          </td>
                        </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DEED REGISTRATIONS QUEUE */}
          {activeTab === "deed" && (
            <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
              {isDeedLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading deed approval queue…</div>
              ) : deedQueue.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600/60 mb-3" />
                  <h3 className="text-base font-semibold text-foreground">Inbox is clear</h3>
                  <p className="text-xs text-muted-foreground mt-1">There are no deed registrations awaiting L1 or L2 review at this moment.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">File Number</th>
                        <th className="px-4 py-3">Stage</th>
                        <th className="px-4 py-3">Deed Type</th>
                        <th className="px-4 py-3">Registration Office</th>
                        <th className="px-4 py-3">Project</th>
                        <th className="px-4 py-3">Waiting (Days)</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {deedQueue.map((item) => {
                        const isL1 = item.OverallStatus === "L1 Pending";
                        const stage = isL1 ? "L1" : "L2";
                        return (
                          <tr key={item.DeedRecordId} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-semibold text-foreground">
                              <button
                                onClick={() => navigate(`/legal/deeds/${item.DeedRecordId}`)}
                                className="hover:underline flex items-center gap-1 text-primary"
                              >
                                {item.DeedFileNo}
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  isL1 ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" : "bg-purple-500/10 text-purple-600 border border-purple-500/20"
                                }`}
                              >
                                {isL1 ? "L1 Legal Review" : "L2 Executive Approval"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-foreground">{item.DeedTypeName}</td>
                            <td className="px-4 py-3 text-xs text-foreground">{item.OfficeName}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{item.ProjectName || "—"}</td>
                            <td className="px-4 py-3 text-xs font-semibold">
                              <span className={item.WaitingDays > 2 ? "text-red-600" : "text-foreground"}>
                                {item.WaitingDays} days
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right space-x-1">
                              {rights.canApprove && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-amber-600 text-xs"
                                    onClick={() => {
                                      setActiveDeedItem({ id: item.DeedRecordId, stage, fileNo: item.DeedFileNo });
                                      setModalAction("Return");
                                      setRemarks("");
                                    }}
                                  >
                                    Return
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                                    onClick={() => {
                                      setActiveDeedItem({ id: item.DeedRecordId, stage, fileNo: item.DeedFileNo });
                                      setModalAction("Approve");
                                      setRemarks("");
                                    }}
                                  >
                                    Approve
                                  </Button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal: Deed Approval Confirmation */}
        <Dialog open={!!activeDeedItem} onOpenChange={() => setActiveDeedItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {modalAction} {activeDeedItem?.stage} Review — {activeDeedItem?.fileNo}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleDeedActionSubmit} className="space-y-4 py-2">
              <div>
                <Label>Comments / Instructions *</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={`Provide ${modalAction === "Return" ? "reasons for returning to executive" : "approval remarks"}`}
                  required={modalAction === "Return" || modalAction === "Reject"}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setActiveDeedItem(null)}>
                  Cancel
                </Button>
                <Button type="submit">Confirm {modalAction}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </LegalShell>
    </>
  );
}
