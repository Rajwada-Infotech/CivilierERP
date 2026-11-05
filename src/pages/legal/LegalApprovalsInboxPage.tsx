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
import {
  getLandPendingQueue,
  verifyLand,
  actionLandL1,
  actionLandL2,
  type LandPendingQueueItem,
} from "@/api/legalLandApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function LegalApprovalsInboxPage() {
  const rights = usePageRights("legal-approvals");
  const landRights = usePageRights("legal-land-master");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"land" | "deed">("land");

  // Deed Modal Action State
  const [activeDeedItem, setActiveDeedItem] = useState<{ id: number; stage: "L1" | "L2"; fileNo: string } | null>(null);

  // Land Modal Action State
  const [activeLandItem, setActiveLandItem] = useState<{
    land: LandPendingQueueItem;
    action: "Verify" | "L1-Approve" | "L1-Return" | "L2-Approve" | "L2-Return" | "L2-Reject";
    title: string;
  } | null>(null);

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

  // Land Mutations
  const verifyLandMutation = useMutation({
    mutationFn: (p: { id: number; remarks: string }) => verifyLand(p.id, p.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-land-pending-queue"] });
      queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
      setActiveLandItem(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const l1LandMutation = useMutation({
    mutationFn: (p: { id: number; action: "Approve" | "Return"; remarks: string }) =>
      actionLandL1(p.id, p.action, p.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-land-pending-queue"] });
      queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
      setActiveLandItem(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const l2LandMutation = useMutation({
    mutationFn: (p: { id: number; action: "Approve" | "Return" | "Reject"; remarks: string }) =>
      actionLandL2(p.id, p.action, p.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-land-pending-queue"] });
      queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
      setActiveLandItem(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

  const handleLandActionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLandItem) return;
    const { land, action } = activeLandItem;

    if (action === "Verify") {
      verifyLandMutation.mutate({ id: land.LandId, remarks });
    } else if (action === "L1-Approve") {
      l1LandMutation.mutate({ id: land.LandId, action: "Approve", remarks });
    } else if (action === "L1-Return") {
      l1LandMutation.mutate({ id: land.LandId, action: "Return", remarks });
    } else if (action === "L2-Approve") {
      l2LandMutation.mutate({ id: land.LandId, action: "Approve", remarks });
    } else if (action === "L2-Return") {
      l2LandMutation.mutate({ id: land.LandId, action: "Return", remarks });
    } else if (action === "L2-Reject") {
      l2LandMutation.mutate({ id: land.LandId, action: "Reject", remarks });
    }
  };

  const isLandPending =
    verifyLandMutation.isPending || l1LandMutation.isPending || l2LandMutation.isPending;

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Approval Inbox" }]} />
      <LegalShell
        title="Two-Level Approval Inbox"
        subtitle="Review, return, or formally approve land property records and deed registrations across L1 (Legal Officer) and L2 (Executive / Partner)."
        icon={ClipboardTick}
      >
        <div className="space-y-6">
          {/* Dual Tabs */}
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <button
              onClick={() => setActiveTab("land")}
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-heading font-semibold uppercase tracking-wider rounded-lg transition-colors ${
                activeTab === "land"
                  ? "bg-foreground text-card shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Building2 size={14} /> Land Records Queue
              <span className={`px-1.5 py-0.2 rounded-full text-[0.625rem] ${
                activeTab === "land" ? "bg-card text-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {landQueue.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("deed")}
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-heading font-semibold uppercase tracking-wider rounded-lg transition-colors ${
                activeTab === "deed"
                  ? "bg-foreground text-card shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <FileText size={14} /> Deed Registrations Queue
              <span className={`px-1.5 py-0.2 rounded-full text-[0.625rem] ${
                activeTab === "deed" ? "bg-card text-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {deedQueue.length}
              </span>
            </button>
          </div>

          {/* TAB 1: LAND RECORDS APPROVAL QUEUE */}
          {activeTab === "land" && (
            <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
              {isLandLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading land approval queue…</div>
              ) : landQueue.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600/60 mb-3" />
                  <h3 className="text-base font-semibold text-foreground">Land Approval Inbox is clear</h3>
                  <p className="text-xs text-muted-foreground mt-1">There are no company land records awaiting verification or approvals at this time.</p>
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
                        const isVerify = item.Stage === "Verification Pending";
                        const isL1 = item.Stage === "L1 Legal Review";
                        const isL2 = item.Stage === "L2 Executive Approval";

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
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                                  isVerify
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    : isL1
                                    ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                    : "bg-purple-500/10 text-purple-600 border-purple-500/20"
                                }`}
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

                              {/* Stage 1: Verification Pending */}
                              {isVerify && (landRights.canEdit || rights.canApprove) && (
                                <Button
                                  size="sm"
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                                  onClick={() => {
                                    setActiveLandItem({ land: item, action: "Verify", title: `Verify Land — ${item.LandCode}` });
                                    setRemarks("");
                                  }}
                                >
                                  Verify Data
                                </Button>
                              )}

                              {/* Stage 2: L1 Legal Review */}
                              {isL1 && rights.canApprove && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-amber-600 text-xs"
                                    onClick={() => {
                                      setActiveLandItem({ land: item, action: "L1-Return", title: `Return L1 Review — ${item.LandCode}` });
                                      setRemarks("");
                                    }}
                                  >
                                    Return
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                                    onClick={() => {
                                      setActiveLandItem({ land: item, action: "L1-Approve", title: `L1 Approve — ${item.LandCode}` });
                                      setRemarks("");
                                    }}
                                  >
                                    L1 Approve
                                  </Button>
                                </>
                              )}

                              {/* Stage 3: L2 Executive Approval */}
                              {isL2 && rights.canApprove && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-amber-600 text-xs"
                                    onClick={() => {
                                      setActiveLandItem({ land: item, action: "L2-Return", title: `Return to L1 — ${item.LandCode}` });
                                      setRemarks("");
                                    }}
                                  >
                                    Return
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-destructive text-xs"
                                    onClick={() => {
                                      setActiveLandItem({ land: item, action: "L2-Reject", title: `Reject Property — ${item.LandCode}` });
                                      setRemarks("");
                                    }}
                                  >
                                    Reject
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                                    onClick={() => {
                                      setActiveLandItem({ land: item, action: "L2-Approve", title: `L2 Final Sign-Off — ${item.LandCode}` });
                                      setRemarks("");
                                    }}
                                  >
                                    L2 Approve
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

        {/* Modal: Land Approval Confirmation */}
        <Dialog open={!!activeLandItem} onOpenChange={() => setActiveLandItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{activeLandItem?.title}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Property: {activeLandItem?.land.LandCode} · {activeLandItem?.land.LandName}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleLandActionSubmit} className="space-y-4 py-2">
              <div>
                <Label>Comments / Instructions {activeLandItem?.action.includes("Return") || activeLandItem?.action.includes("Reject") ? "*" : "(Optional)"}</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Provide instructions or remarks for this action..."
                  required={activeLandItem?.action.includes("Return") || activeLandItem?.action.includes("Reject")}
                  rows={3}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setActiveLandItem(null)} disabled={isLandPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLandPending}>
                  {isLandPending ? "Processing..." : "Confirm Action"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </LegalShell>
    </>
  );
}
