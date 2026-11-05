import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getLegalDeedDetails,
  verifyDocumentStatus,
  submitDeedForL1,
  actionDeedL1,
  actionDeedL2,
  type LegalDocumentItem,
} from "@/api/legalOperationsApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ── 5-stage workflow status bar ──────────────────────────────────────────────
type Stage = "Draft Entry" | "Data Verified" | "L1 Approved" | "L2 Approved" | "Active";
const STAGES: Stage[] = ["Draft Entry", "Data Verified", "L1 Approved", "L2 Approved", "Active"];

function resolveStage(overallStatus: string, l1Status: string, l2Status: string): Stage {
  if (l2Status === "Approved") return "L2 Approved";
  if (l1Status === "Approved") return "L1 Approved";
  if (["L1 Pending", "L1 Returned"].includes(overallStatus)) return "Data Verified";
  if (["Dossier Created", "Awaiting Registered Deed", "L2 Pending", "L2 Returned"].includes(overallStatus)) return "Data Verified";
  return "Draft Entry";
}

export default function LegalDeedDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rights = usePageRights("legal-deed-registrations");
  const approvalRights = usePageRights("legal-approvals");

  // Document action modal
  const [selectedDoc, setSelectedDoc] = useState<LegalDocumentItem | null>(null);
  const [docStatus, setDocStatus] = useState("Accepted");
  const [rejectReason, setRejectReason] = useState("");
  const [notes, setNotes] = useState("");
  const [isWaived, setIsWaived] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");
  const [isNA, setIsNA] = useState(false);
  const [naReason, setNaReason] = useState("");

  // Workflow action modal
  const [workflowAction, setWorkflowAction] = useState<"L1_Approve" | "L1_Return" | "L2_Approve" | "L2_Return" | "L2_Reject" | null>(null);
  const [workflowRemarks, setWorkflowRemarks] = useState("");

  const deedId = Number(id);

  const { data, isLoading, error } = useQuery({
    queryKey: ["legal-deed-details", deedId],
    queryFn: () => getLegalDeedDetails(deedId),
    enabled: !!deedId,
  });

  const docMutation = useMutation({
    mutationFn: (payload: { docId: number; data: any }) =>
      verifyDocumentStatus(deedId, payload.docId, payload.data),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-deed-details", deedId] });
      setSelectedDoc(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitL1Mutation = useMutation({
    mutationFn: () => submitDeedForL1(deedId),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-deed-details", deedId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const l1Mutation = useMutation({
    mutationFn: (payload: { action: "Approve" | "Return"; remarks: string }) =>
      actionDeedL1(deedId, payload.action, payload.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-deed-details", deedId] });
      setWorkflowAction(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const l2Mutation = useMutation({
    mutationFn: (payload: { action: "Approve" | "Return" | "Reject"; remarks: string }) =>
      actionDeedL2(deedId, payload.action, payload.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-deed-details", deedId] });
      setWorkflowAction(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div className="p-8 text-center text-sm">Loading deed details…</div>;
  if (error || !data) return <div className="p-8 text-center text-sm text-destructive">Could not load deed file.</div>;

  const { deed, documents, logs } = data;

  const handleDocSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc) return;
    docMutation.mutate({
      docId: selectedDoc.DocumentId,
      data: {
        VerificationStatus: docStatus,
        RejectionReason: rejectReason || null,
        VerificationNotes: notes || null,
        IsNA: isNA,
        NAReason: naReason || null,
        IsWaived: isWaived,
        WaiverReason: waiverReason || null,
      },
    });
  };

  const handleWorkflowSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflowAction) return;

    if (workflowAction === "L1_Approve") l1Mutation.mutate({ action: "Approve", remarks: workflowRemarks });
    if (workflowAction === "L1_Return") l1Mutation.mutate({ action: "Return", remarks: workflowRemarks });
    if (workflowAction === "L2_Approve") l2Mutation.mutate({ action: "Approve", remarks: workflowRemarks });
    if (workflowAction === "L2_Return") l2Mutation.mutate({ action: "Return", remarks: workflowRemarks });
    if (workflowAction === "L2_Reject") l2Mutation.mutate({ action: "Reject", remarks: workflowRemarks });
  };

  const canSubmitL1 = deed.OverallStatus === "Awaiting Registered Deed" || deed.OverallStatus === "L1 Returned" || deed.OverallStatus === "Dossier Created";
  const canActL1 = deed.OverallStatus === "L1 Pending" && approvalRights.canApprove;
  const canActL2 = deed.OverallStatus === "L2 Pending" && approvalRights.canApprove;

  // ── 5-stage status bar ──
  const currentStage = resolveStage(deed.OverallStatus, deed.L1Status, deed.L2Status);
  const currentStageIdx = STAGES.indexOf(currentStage);
  const pendingMandatory = documents.filter((d) => d.IsMandatory && d.VerificationStatus !== "Accepted" && !d.IsWaived).length;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Dashboard", path: "/home" },
          { label: "Legal", path: "/legal" },
          { label: "Land Deed Entries", path: "/legal/deeds" },
          { label: deed.DeedFileNo },
        ]}
      />
      <LegalShell
        title={`${deed.DeedFileNo} — ${deed.DeedTypeName}`}
        subtitle={`${deed.OfficeName} · ${deed.OverallStatus}`}
        icon={FileText}
      >
        <div className="w-full space-y-6">
            {/* Top Bar Navigation & Actions */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
              <Button variant="outline" size="sm" onClick={() => navigate("/legal/deeds")} className="gap-2">
                <ArrowLeft size={16} /> Back to Deeds
              </Button>
              <div className="flex items-center gap-2">
                {canSubmitL1 && (
                  <Button size="sm" onClick={() => submitL1Mutation.mutate()} disabled={submitL1Mutation.isPending} className="bg-primary text-primary-foreground font-semibold">
                    Submit for L1 Review
                  </Button>
                )}
                {canActL1 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                      onClick={() => {
                        setWorkflowAction("L1_Return");
                        setWorkflowRemarks("");
                      }}
                    >
                      Return for Correction
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      onClick={() => {
                        setWorkflowAction("L1_Approve");
                        setWorkflowRemarks("");
                      }}
                    >
                      L1 Approve
                    </Button>
                  </>
                )}
                {canActL2 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => {
                        setWorkflowAction("L2_Reject");
                        setWorkflowRemarks("");
                      }}
                    >
                      Reject Deed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                      onClick={() => {
                        setWorkflowAction("L2_Return");
                        setWorkflowRemarks("");
                      }}
                    >
                      Return to L1
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      onClick={() => {
                        setWorkflowAction("L2_Approve");
                        setWorkflowRemarks("");
                      }}
                    >
                      Final L2 Approval
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* ── 5-Stage Workflow Status Bar ─────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="text-xs font-heading font-semibold uppercase tracking-wider text-foreground">
                  Deed Workflow Progress
                </h3>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {documents.filter((d) => d.VerificationStatus === "Accepted" || d.IsWaived).length}/{documents.length} docs verified
                  {pendingMandatory > 0 && <span className="ml-2 text-amber-600 font-semibold">· {pendingMandatory} mandatory pending</span>}
                </span>
              </div>

              {/* Stage rail */}
              <div className="relative flex items-center">
                {STAGES.map((stage, idx) => {
                  const done = idx < currentStageIdx;
                  const active = idx === currentStageIdx;
                  return (
                    <React.Fragment key={stage}>
                      {idx > 0 && (
                        <div className={`h-0.5 flex-1 transition-colors ${done ? "bg-emerald-500" : "bg-border"}`} />
                      )}
                      <div className="flex flex-col items-center shrink-0">
                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                            done
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : active
                              ? "border-foreground bg-foreground text-card"
                              : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          {done ? <CheckCircle2 size={14} /> : idx + 1}
                        </div>
                        <span
                          className={`mt-1.5 text-center text-[0.6rem] font-heading font-semibold uppercase tracking-[0.08em] whitespace-nowrap ${
                            done ? "text-emerald-600" : active ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {stage}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* L1 / L2 detail row */}
              {(deed.L1Status !== "Pending" || deed.L2Status !== "Pending") && (
                <div className="mt-4 flex flex-wrap gap-3 border-t border-border/60 pt-3 text-xs">
                  <span className={`inline-flex items-center gap-1.5 ${deed.L1Status === "Approved" ? "text-emerald-600" : deed.L1Status === "Returned" ? "text-amber-600" : "text-muted-foreground"}`}>
                    {deed.L1Status === "Approved" ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                    <span className="font-semibold">L1:</span> {deed.L1Status}
                    {deed.L1ReviewerName && <span className="text-muted-foreground"> · {deed.L1ReviewerName}</span>}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 ${deed.L2Status === "Approved" ? "text-emerald-600" : deed.L2Status === "Returned" ? "text-amber-600" : "text-muted-foreground"}`}>
                    {deed.L2Status === "Approved" ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                    <span className="font-semibold">L2:</span> {deed.L2Status}
                    {deed.L2ApproverName && <span className="text-muted-foreground"> · {deed.L2ApproverName}</span>}
                  </span>
                  {deed.L2Status === "Approved" && (
                    <button
                      onClick={() => navigate("/legal/active-land")}
                      className="ml-auto inline-flex items-center gap-1 text-emerald-600 hover:underline font-semibold"
                    >
                      View in Active Land Register <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Deed Metadata Grid with Distinct RS & LR Fields */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-4">
              <div className="flex items-center flex-wrap justify-between border-b border-border/60 pb-2 gap-2">
                <h3 className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
                  Property & Deed Identifiers
                </h3>
                <span className="text-[0.6875rem] text-primary font-semibold">West Bengal Land Records</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground block">Registered Deed No.</span>
                  <span className="font-semibold text-foreground font-mono">{deed.DeedNo || "— (Awaiting deed number)"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Registration Office</span>
                  <span className="font-semibold text-foreground">{deed.OfficeName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Project Link</span>
                  <span className="font-semibold text-foreground">{deed.ProjectName || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Mouza / J.L. No.</span>
                  <span className="font-semibold text-foreground">{deed.MouzaName ? `${deed.MouzaName} (J.L. ${deed.JLNo || "71"})` : "—"}</span>
                </div>

                {/* Distinct RS & LR fields */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                  <span className="text-[0.625rem] font-semibold text-primary block uppercase">RS Dag (Plot)</span>
                  <span className="font-bold text-foreground text-sm">{deed.RsDag || deed.RsPlotNo || "—"}</span>
                </div>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
                  <span className="text-[0.625rem] font-semibold text-blue-600 dark:text-blue-400 block uppercase">LR Dag (Plot)</span>
                  <span className="font-bold text-foreground text-sm">{deed.LrDag || deed.RsDag || deed.RsPlotNo || "—"}</span>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                  <span className="text-[0.625rem] font-semibold text-primary block uppercase">RS Khatian</span>
                  <span className="font-bold text-foreground text-sm">{deed.RsKhatian || deed.RsKhatianNo || "—"}</span>
                </div>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
                  <span className="text-[0.625rem] font-semibold text-blue-600 dark:text-blue-400 block uppercase">LR Khatian</span>
                  <span className="font-bold text-foreground text-sm">{deed.LrKhatian || "—"}</span>
                </div>

                <div>
                  <span className="text-muted-foreground block">Purchased Area</span>
                  <span className="font-semibold text-foreground">{deed.PurchasedArea ? `${deed.PurchasedArea} ${deed.AreaUnitName || ""}` : "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Consideration / Value</span>
                  <span className="font-semibold text-foreground">{deed.ConsiderationAmount ? `₹${Number(deed.ConsiderationAmount).toLocaleString("en-IN")}` : "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Seller (Vendor)</span>
                  <span className="font-semibold text-foreground">{deed.SellerName || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Buyer (Entity)</span>
                  <span className="font-semibold text-foreground">{deed.BuyerName || "—"}</span>
                </div>
              </div>
            </div>

            {/* Checklist Documents Table */}
            <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
              <div className="p-4 border-b border-border/60 flex items-center flex-wrap justify-between gap-2">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground">Required Document Checklist</h3>
                  <p className="text-xs text-muted-foreground">Every document is individually reviewed, accepted, rejected, or waived.</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Document Requirement</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Mandatory</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Verification Notes</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {documents.map((doc) => (
                      <tr key={doc.DocumentId} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {doc.DocTypeName}
                          {doc.FileName && <span className="block text-muted-foreground font-normal">{doc.FileName}</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{doc.DocCategory}</td>
                        <td className="px-4 py-3">
                          {doc.IsMandatory ? (
                            <span className="text-red-600 font-semibold">Mandatory</span>
                          ) : (
                            <span className="text-muted-foreground">Optional</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-medium ${
                              doc.VerificationStatus === "Accepted"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : doc.VerificationStatus === "Rejected"
                                ? "bg-red-500/10 text-red-600"
                                : doc.IsWaived
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-amber-500/10 text-amber-600"
                            }`}
                          >
                            {doc.IsWaived ? "Waived" : doc.VerificationStatus}
                          </span>
                          {doc.VerifiedByName && (
                            <span className="block text-[0.625rem] text-muted-foreground mt-0.5">by {doc.VerifiedByName}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                          {doc.WaiverReason ? `Waiver: ${doc.WaiverReason}` : doc.RejectionReason ? `Rejected: ${doc.RejectionReason}` : doc.VerificationNotes || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {rights.canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedDoc(doc);
                                setDocStatus(doc.VerificationStatus);
                                setRejectReason(doc.RejectionReason || "");
                                setNotes(doc.VerificationNotes || "");
                                setIsWaived(doc.IsWaived);
                                setWaiverReason(doc.WaiverReason || "");
                                setIsNA(doc.IsNA);
                                setNaReason(doc.NAReason || "");
                              }}
                            >
                              Verify / Review
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit History Log */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3">
              <h3 className="text-sm font-heading font-semibold text-foreground uppercase tracking-wider">Approval & Audit Trail</h3>
              <div className="space-y-3 text-xs">
                {logs.map((log) => (
                  <div key={log.LogId} className="flex items-start gap-3 border-l-2 border-primary/30 pl-3 py-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{log.Action}</span>
                        <span className="text-[0.625rem] text-muted-foreground">
                          {new Date(log.ActionAt).toLocaleString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {log.Comments && <p className="text-muted-foreground mt-0.5">{log.Comments}</p>}
                      <span className="text-[0.625rem] text-muted-foreground block mt-0.5">Action taken by: {log.ActionByName}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        {/* Modal: Document Verification */}
        <Dialog open={!!selectedDoc} onOpenChange={() => setSelectedDoc(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Verify Document: {selectedDoc?.DocTypeName}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleDocSubmit} className="space-y-4 py-2">
              <div>
                <Label>Verification Status *</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={docStatus}
                  onChange={(e) => setDocStatus(e.target.value)}
                  required
                >
                  <option value="Accepted">Accepted / Verified Clean</option>
                  <option value="Under Review">Under Review / Examination</option>
                  <option value="Rejected">Rejected / Discrepancy Found</option>
                  <option value="Requested">Requested from Seller/Office</option>
                  <option value="Not Applicable">Not Applicable (N/A)</option>
                </select>
              </div>

              {docStatus === "Rejected" && (
                <div>
                  <Label>Rejection Reason *</Label>
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. illegible stamp or missing signature"
                    required
                  />
                </div>
              )}

              <div>
                <Label>Verification Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes from advocate or legal review"
                />
              </div>

              <div className="border-t border-border/60 pt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isWaived"
                    checked={isWaived}
                    onChange={(e) => setIsWaived(e.target.checked)}
                    className="rounded border-input"
                  />
                  <Label htmlFor="isWaived" className="text-xs">
                    Waive this document (requires managerial reason)
                  </Label>
                </div>
                {isWaived && (
                  <div>
                    <Label className="text-xs">Waiver Reason *</Label>
                    <Input
                      value={waiverReason}
                      onChange={(e) => setWaiverReason(e.target.value)}
                      placeholder="e.g. Approved by Partner"
                      required
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isNA"
                    checked={isNA}
                    onChange={(e) => setIsNA(e.target.checked)}
                    className="rounded border-input"
                  />
                  <Label htmlFor="isNA" className="text-xs">
                    Mark as Not Applicable (N/A)
                  </Label>
                </div>
                {isNA && (
                  <div>
                    <Label className="text-xs">N/A Justification *</Label>
                    <Input
                      value={naReason}
                      onChange={(e) => setNaReason(e.target.value)}
                      placeholder="e.g. Property is freehold; no conversion required"
                      required
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSelectedDoc(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={docMutation.isPending}>
                  {docMutation.isPending ? "Saving…" : "Save Document Review"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Modal: Workflow Actions (L1 & L2) */}
        <Dialog open={!!workflowAction} onOpenChange={() => setWorkflowAction(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {workflowAction === "L1_Approve" && "L1 Legal Approval"}
                {workflowAction === "L1_Return" && "Return Deed for Correction"}
                {workflowAction === "L2_Approve" && "L2 Final Partner / Executive Approval"}
                {workflowAction === "L2_Return" && "Return Deed to L1 Review"}
                {workflowAction === "L2_Reject" && "Reject Land Deed Acquisition"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleWorkflowSubmit} className="space-y-4 py-2">
              <div>
                <Label>Decision Remarks / Comments</Label>
                <Textarea
                  value={workflowRemarks}
                  onChange={(e) => setWorkflowRemarks(e.target.value)}
                  placeholder="Enter detailed review findings, conditions, or reason..."
                  rows={4}
                  required={workflowAction?.includes("Return") || workflowAction?.includes("Reject")}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setWorkflowAction(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={l1Mutation.isPending || l2Mutation.isPending}
                  className={
                    workflowAction?.includes("Reject")
                      ? "bg-red-600 hover:bg-red-700 text-white"
                      : workflowAction?.includes("Return")
                      ? "bg-amber-600 hover:bg-amber-700 text-white"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                  }
                >
                  Confirm Decision
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </LegalShell>
    </>
  );
}
