import { useParams, useNavigate } from "react-router-dom";
import { MoneySend } from "iconsax-react";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalMasterTable } from "../LegalMasterPage";

// Selling land the company has acquired — separate from the acquisition pipeline, mapped to the same Land ID.
// /legal/land/sales lists every land's sales; /legal/land/properties/:id/sales is one land's.
export default function LandSalesPage() {
  const params = useParams();
  const landId = params.id ? Number(params.id) : undefined;
  const navigate = useNavigate();
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", landId ? "Land sales" : "Land Sales"]} />
      <LegalShell
        title={landId ? "Sales of this land" : "Land Sales"}
        subtitle="The company selling acquired land. Only an acquired land can be sold, and never more than its unsold area."
        icon={MoneySend}
        action={landId ? <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => navigate(`/legal/land/properties/${landId}`)}><ArrowLeft size={13} /> Land</button> : undefined}
      >
        <div className="space-y-4">
          <LegalMasterTable entry={{ pageKey: "legal-land-master", key: "land-sale", label: "Sales" }} parentId={landId} />
          {landId && <LegalMasterTable entry={{ pageKey: "legal-land-master", key: "payment", label: "Payments (purchase and sale)" }} parentId={landId} />}
        </div>
      </LegalShell>
    </>
  );
}
