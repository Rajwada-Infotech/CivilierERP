import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardTick } from "iconsax-react";
import { ChevronRight, CheckCircle2, RotateCcw, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalPendingQueue, actionDeedL1, actionDeedL2 } from "@/api/legalOperationsApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function LegalApprovalsInboxPage() {
  const rights = usePageRights("legal-approvals");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeItem, setActiveItem] = useState<{ id: number; stage: "L1" | "L2"; fileNo: string } | null>(null);
  const [modalAction, setModalAction] = useState<"Approve" | "Return" | "Reject" | null>(null);
  const [remarks, setRemarks] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["legal-pending-queue"],
    queryFn: getLegalPendingQueue,
  });

  const l1Mutation = useMutation({
    mutationFn: (payload: { id: number; action: "Approve" | "Return"; remarks: string }) =>
      actionDeedL1(payload.id, payload.action, payload.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-pending-queue"] });
      setActiveItem(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const l2Mutation = useMutation({
    mutationFn: (payload: { id: number; action: "Approve" | "Return" | "Reject"; remarks: string }) =>
      actionDeedL2(payload.id, payload.action, payload.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-pending-queue"] });
      setActiveItem(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const queue = data?.approvalQueue || [];

  const handleActionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !modalAction) return;

    if (activeItem.stage === "L1") {
      l1Mutation.mutate({ id: activeItem.id, action: modalAction as any, remarks });
    } else {
      l2Mutation.mutate({ id: activeItem.id, action: modalAction, remarks });
    }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Approval Inbox" }]} />
      <LegalShell
        title="Two-Level Approval Inbox"
        subtitle="Review, return, or formally approve land deed dossiers across L1 (Legal Officer) and L2 (Director/Partner)."
        icon={ClipboardTick}
      >
        <div className="space-y-6">
          <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading approval queue…</div>
            ) : queue.length === 0 ? (
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
                    {queue.map((item) => {
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
                                    setActiveItem({ id: item.DeedRecordId, stage, fileNo: item.DeedFileNo });
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
                                    setActiveItem({ id: item.DeedRecordId, stage, fileNo: item.DeedFileNo });
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
        </div>

        {/* Modal: Approval confirmation */}
        <Dialog open={!!activeItem} onOpenChange={() => setActiveItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {modalAction} {activeItem?.stage} Review — {activeItem?.fileNo}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleActionSubmit} className="space-y-4 py-2">
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
                <Button type="button" variant="outline" onClick={() => setActiveItem(null)}>
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
