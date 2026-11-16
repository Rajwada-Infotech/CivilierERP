import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardTick } from "iconsax-react";
import { CheckCircle2, Eye } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getLandPendingQueue } from "@/api/legalLandApi";
import { Button } from "@/components/ui/button";

// Pending Verification: lands waiting for Final Verify. (Deed Registration has its own page — LandDeedRegistrationPage.)
export default function LegalApprovalsInboxPage() {
  const landRights = usePageRights("legal-land-master");
  const navigate = useNavigate();
  const { data: landQueue = [], isLoading: isLandLoading } = useQuery({
    queryKey: ["legal-land-pending-queue"],
    queryFn: getLandPendingQueue,
  });

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Pending Verification" }]} />
      <LegalShell
        title="Pending Verification"
        subtitle="Lands waiting for final verification (Final Verify opens every detail and document; verified land goes to Deed Process)."
        icon={ClipboardTick}
      >
        <div className="space-y-6">
          {/* TAB 1: LAND RECORDS APPROVAL QUEUE */}
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
        </div>
      </LegalShell>
    </>
  );
}
