// Menu Rights. Split into parts under ./menuRights: useMenuRights holds the state; the subject picker,
// toolbar, table and footer each have their own file.
import { ShieldCheck, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
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

      <AdminShell
        title="Menu Rights"
        subtitle="Configure per-user page and action permissions"
        icon={ShieldCheck}
        action={
          hasSubjectSelected && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">
                Quick presets:
              </span>
              {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="px-2.5 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/80 text-foreground transition-colors"
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Loader2 size={12} className="animate-spin" /> Loading page
            definitions…
          </div>
        )}

        {/* Main panel */}
        {!hasSubjectSelected ? (
          <div className="flex flex-col items-center justify-center h-56 rounded-xl border border-dashed border-border bg-card/40 text-muted-foreground">
            <ShieldCheck className="w-12 h-12 opacity-20 mb-3" />
            <p className="text-sm font-heading">
              {subject === "user"
                ? "Select a user to manage permissions"
                : "Select a role to manage its baseline permissions"}
            </p>
          </div>
        ) : loadingPerms ? (
          <div className="flex justify-center items-center h-64 rounded-xl border border-border bg-card/40">
            <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
            <RightsToolbar m={m} />

            <RightsTable m={m} />

            <RightsFooter m={m} />
          </div>
        )}
      </AdminShell>
    </>
  );
}
