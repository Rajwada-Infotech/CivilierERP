import { Save, Loader2 } from "lucide-react";
import type { MenuRightsState } from "./useMenuRights";

// Below the table: what changed and the save key.
export function RightsFooter({ m }: { m: MenuRightsState }) {
  const { saving, dirty, handleSave, stats } = m;
  return (
    <>
      {/* Footer */}
      <div className="px-4 py-3 border-t border-foreground flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {stats.pagesGranted} of {stats.total} pages ·{" "}
          {stats.actionsGranted} total actions granted
        </p>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-5 shrink-0 bg-foreground text-card border border-foreground"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? "Saving…" : "Save permissions"}
        </button>
      </div>
    </>
  );
}
