import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageQuestion } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { convertEnquiry, setEnquiryStatus } from "@/api/legalLandApi";
import { askLegal } from "@/components/legal/LegalAsk";
import { LegalMasterTable } from "../LegalMasterPage";
import { legalMasterByKey } from "../legalMasters";

// Step 1 of the pipeline: land enquiries. Converting one creates the Land ID and opens its pipeline;
// a converted enquiry stays as it was, linked to its land.
export default function LandEnquiryPage() {
  const entry = legalMasterByKey("land-enquiry")!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const landRights = usePageRights("legal-land-master");
  const rights = usePageRights(entry.pageKey);

  const convert = async (id: number, no: string) => {
    if (!(await askLegal({ title: `Convert enquiry ${no}?`, message: "A new Land ID is created and its pipeline opens. The enquiry becomes read-only.", confirmText: "Convert to land" }))) return;
    try {
      const r = await convertEnquiry(id);
      toast.success(r.message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      navigate(`/legal/land/properties/${r.landId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not convert");
    }
  };

  const changeStatus = async (id: number, no: string, status: "Rejected" | "On Hold" | "Under Review") => {
    let reason: string | undefined;
    if (status !== "Under Review") {
      const r = await askLegal({
        title: status === "Rejected" ? `Reject enquiry ${no}?` : `Put enquiry ${no} on hold?`,
        message: status === "Rejected" ? "It can be reopened later; it cannot be converted while rejected." : "It cannot be converted while on hold.",
        input: { label: "Reason", required: true },
        confirmText: status === "Rejected" ? "Reject" : "Put on hold", tone: status === "Rejected" ? "danger" : "default",
      });
      if (!r) return;
      reason = r;
    }
    try {
      toast.success((await setEnquiryStatus(id, status, reason)).message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the status");
    }
  };
  const small = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted";
  // Row tint and left edge by enquiry status, so the list reads at a glance.
  const STATUS_ROW: Record<string, string> = {
    "Under Review": "legal-enq-review",
    Interested: "legal-enq-interest",
    "On Hold": "legal-enq-hold",
    Rejected: "legal-enq-rejected",
    "Converted to Land Record": "legal-enq-converted",
  };


  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", entry.label]} />
      <LegalShell title={entry.label} subtitle="New land opportunities. Convert one to create its Land ID and pipeline." icon={MessageQuestion}>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {([["New", "#d4d4d8"], ["Under Review", "#0ea5e9"], ["Interested", "#10b981"], ["On Hold", "#f59e0b"], ["Rejected", "#f43f5e"], ["Converted", "#7c4a2e"]] as const).map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
          ))}
        </div>
        <LegalMasterTable
          entry={entry}
          rowClassName={(raw) => STATUS_ROW[String(raw.EnquiryStatus)]}
          rowActions={(raw) => {
            const id = Number(raw.EnquiryId);
            const no = String(raw.EnquiryNo);
            const st = String(raw.EnquiryStatus);
            if (raw.LandId) {
              return <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className={small}>Open land</button>;
            }
            if (!rights.canEdit) return null;
            // Rejected / on hold: only Resume. Otherwise: Convert, Hold, Reject.
            if (st === "Rejected" || st === "On Hold") {
              return <button onClick={() => changeStatus(id, no, "Under Review")} className={small}>Resume</button>;
            }
            return (
              <span className="inline-flex flex-wrap justify-end gap-1.5">
                {landRights.canCreate && <button onClick={() => convert(id, no)} className={small}>Convert to land</button>}
                <button onClick={() => changeStatus(id, no, "On Hold")} className={small}>Hold</button>
                <button onClick={() => changeStatus(id, no, "Rejected")} className={`${small} text-rose-600`}>Reject</button>
              </span>
            );
          }}
        />
      </LegalShell>
    </>
  );
}
