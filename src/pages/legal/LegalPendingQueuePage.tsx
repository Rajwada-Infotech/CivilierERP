import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Clock, AlertTriangle, FileWarning, ExternalLink } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalPendingQueue } from "@/api/legalOperationsApi";

export default function LegalPendingQueuePage() {
  usePageRights("legal-pending-queue");
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["legal-pending-queue"],
    queryFn: getLegalPendingQueue,
  });

  const pendingDeeds = data?.pendingDeeds || [];
  const missingDocs = data?.missingDocs || [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Pending & Overdue" }]} />
      <LegalShell
        title="Pending Dossiers & Missing Documents"
        subtitle="Track missing registered deeds, rejected checklist evidence, and overdue follow-ups."
        icon={Clock}
      >
        <div className="space-y-8">
          {/* Section 1: Pending Deeds */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                <FileWarning size={16} className="text-amber-600" /> Pending Registered Deed Dossiers ({pendingDeeds.length})
              </h3>
              <p className="text-xs text-muted-foreground">Cases awaiting original/certified registered deed upload or returned for corrections.</p>
            </div>

            <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
              {isLoading ? (
                <div className="p-6 text-sm text-center">Loading…</div>
              ) : pendingDeeds.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">No pending deeds in this queue.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">File Number</th>
                        <th className="px-4 py-3">Office</th>
                        <th className="px-4 py-3">Project</th>
                        <th className="px-4 py-3">Assigned Executive</th>
                        <th className="px-4 py-3">Current Status</th>
                        <th className="px-4 py-3">Age (Days)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {pendingDeeds.map((d) => (
                        <tr
                          key={d.DeedRecordId}
                          onClick={() => navigate(`/legal/deeds/${d.DeedRecordId}`)}
                          className="hover:bg-muted/30 cursor-pointer"
                        >
                          <td className="px-4 py-3 font-semibold text-primary hover:underline">{d.DeedFileNo}</td>
                          <td className="px-4 py-3 text-foreground">{d.OfficeName}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.ProjectName || "—"}</td>
                          <td className="px-4 py-3 text-foreground">{d.AssignedExecutiveName || "Unassigned"}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-amber-500/10 text-amber-600">
                              {d.OverallStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold">{d.AgeDays} days</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Missing Documents */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-600" /> Missing Mandatory Checklist Items ({missingDocs.length})
              </h3>
              <p className="text-xs text-muted-foreground">Documents that block L1 and L2 approvals until uploaded, verified, or waived.</p>
            </div>

            <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
              {isLoading ? (
                <div className="p-6 text-sm text-center">Loading…</div>
              ) : missingDocs.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">No missing mandatory documents!</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Deed File</th>
                        <th className="px-4 py-3">Missing / Rejected Document</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Responsible Staff</th>
                        <th className="px-4 py-3">Due Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {missingDocs.map((doc) => (
                        <tr
                          key={doc.DocumentId}
                          onClick={() => navigate(`/legal/deeds/${doc.DeedRecordId}`)}
                          className="hover:bg-muted/30 cursor-pointer"
                        >
                          <td className="px-4 py-3 font-semibold text-primary hover:underline">{doc.DeedFileNo}</td>
                          <td className="px-4 py-3 font-medium text-foreground">
                            {doc.DocTypeName}
                            {doc.RejectionReason && (
                              <span className="block text-[0.625rem] text-red-600 font-normal">
                                Rejection: {doc.RejectionReason}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{doc.Category}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[0.625rem] font-semibold bg-red-500/10 text-red-600">
                              {doc.VerificationStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground">{doc.ResponsibleUserName || "Unassigned"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{doc.DueDate || "Immediate"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </LegalShell>
    </>
  );
}
