import { useNavigate, useSearchParams } from "react-router-dom";
import { Global } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalMasterTable } from "../LegalMasterPage";
import { legalMasterByKey } from "../legalMasters";

// The Land Property Master register. "Open" goes to the land's pipeline; ?edit=ID opens its edit form
// (the link from the pipeline's Land Property step).
export default function LandPropertyListPage() {
  const entry = legalMasterByKey("land")!;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", entry.label]} />
      <LegalShell title={entry.label} subtitle="Every land property by its Land ID. Open one to work through its pipeline." icon={Global}>
        <LegalMasterTable
          entry={entry}
          requestEditId={params.get("edit")}
          rowActions={(raw) => (
            <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              Open
            </button>
          )}
        />
      </LegalShell>
    </>
  );
}
