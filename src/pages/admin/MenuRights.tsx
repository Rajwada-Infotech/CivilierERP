// Menu Rights. Split into parts under ./menuRights: useMenuRights holds the state; the subject picker,
// toolbar, table and footer each have their own file.
import { ShieldCheck, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { ROLE_PRESETS } from "./menuRights/config";
import { useMenuRights } from "./menuRights/useMenuRights";
import { SubjectPicker } from "./menuRights/SubjectPicker";
import { RightsToolbar } from "./menuRights/RightsToolbar";
import { RightsTable } from "./menuRights/RightsTable";
import { RightsFooter } from "./menuRights/RightsFooter";

export default function MenuRights() {
  const m = useMenuRights();
  const { loadingDefs, subject, permissions, loadingPerms, applyPreset, hasSubjectSelected } = m;

  return (
    <>
      <Breadcrumbs items={[{ label: "Admin" }, { label: "Menu Rights" }]} />

      <SheetShell
        eyebrow="CivilierERP · Admin · Rights"
        title="Menu rights"
        subtitle="Which pages a role or a person can open, and what they may do on each of them."
        action={
          hasSubjectSelected && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mr-1">
                Presets
              </span>
              {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-8 px-3 border border-foreground/40 text-foreground hover:border-foreground"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )
        }
      >
        <SubjectPicker m={m} />

        {/* Loading page definitions */}
        {loadingDefs && (
          <div className="flex items-center gap-2 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" /> Loading page
            definitions…
          </div>
        )}

        {/* Main panel */}
        {!hasSubjectSelected ? (
          <div className="flex items-center justify-center h-40 border border-dashed border-foreground/40 text-muted-foreground">
            <p className="text-sm">
              {subject === "user"
                ? "Select a user to manage permissions"
                : "Select a role to manage its baseline permissions"}
            </p>
          </div>
        ) : loadingPerms ? (
          <div className="flex justify-center items-center h-40 bg-card border border-foreground">
            <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="bg-card border border-foreground overflow-hidden">
            <RightsToolbar m={m} />

            <RightsTable m={m} />

            <RightsFooter m={m} />
          </div>
        )}
      </SheetShell>
    </>
  );
}
