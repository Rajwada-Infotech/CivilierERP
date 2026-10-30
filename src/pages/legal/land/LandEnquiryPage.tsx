import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageQuestion } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { convertEnquiry } from "@/api/legalLandApi";
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
    if (!window.confirm(`Convert enquiry ${no} to a land property? A new Land ID is created and the enquiry becomes read-only.`)) return;
    try {
      const r = await convertEnquiry(id);
      toast.success(r.message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      navigate(`/legal/land/properties/${r.landId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not convert");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", entry.label]} />
      <LegalShell title={entry.label} subtitle="New land opportunities. Convert one to create its Land ID and pipeline." icon={MessageQuestion}>
        <LegalMasterTable
          entry={entry}
          rowActions={(raw) =>
            raw.LandId ? (
              <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                Open land
              </button>
            ) : landRights.canCreate && rights.canEdit && raw.EnquiryStatus !== "Rejected" ? (
              <button onClick={() => convert(Number(raw.EnquiryId), String(raw.EnquiryNo))} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                Convert to land
              </button>
            ) : null
          }
        />
      </LegalShell>
    </>
  );
}
