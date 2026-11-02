import { useNavigate } from "react-router-dom";
import { Note1, DocumentText } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalMasterTable } from "../LegalMasterPage";

// RS / LR registers across all land properties. Every row belongs to a Land ID; records are added and
// edited on that land's step 4 (Land Details & Record Mapping), so here they are listed, searched and
// exported, and "Open land" goes to the land.
const KINDS = {
  rs: { key: "land-rs-record", title: "RS Record Register", subtitle: "Revisional Survey Khatian & Dag of every land property", icon: Note1 },
  lr: { key: "land-lr-record", title: "LR Record of Rights Register", subtitle: "Land Reforms Khatian & Dag (RoR) of every land property", icon: DocumentText },
} as const;

export default function LandRecordRegisterPage({ kind }: { kind: keyof typeof KINDS }) {
  const k = KINDS[kind];
  const navigate = useNavigate();
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", k.title]} />
      <LegalShell title={k.title} subtitle={`${k.subtitle}. Add or change records on the land's step 4.`} icon={k.icon}>
        <LegalMasterTable
          key={k.key}
          entry={{ key: k.key, label: k.title, pageKey: "legal-land-master" }}
          noAdd
          rowActions={(raw) => (
            <button onClick={(e) => { e.stopPropagation(); navigate(`/legal/land/properties/${raw.LandId}`); }} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              Open land
            </button>
          )}
        />
      </LegalShell>
    </>
  );
}
