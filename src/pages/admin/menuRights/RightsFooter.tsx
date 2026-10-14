import { Save, Loader2 } from "lucide-react";
import type { MenuRightsState } from "./useMenuRights";

// Below the table: what changed and the save key.
export function RightsFooter({ m }: { m: MenuRightsState }) {
  const { saving, dirty, handleSave, stats } = m;
  return (
    <>
      {/* Footer */}
      <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-body">
          {stats.pagesGranted} of {stats.total} pages ·{" "}
          {stats.actionsGranted} total actions granted
        </p>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="btn-module shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto inline-flex items-center rounded-lg disabled:opacity-50 transition-all"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? "Saving…" : "Save Permissions"}
        </button>
      </div>
    </>
  );
}
