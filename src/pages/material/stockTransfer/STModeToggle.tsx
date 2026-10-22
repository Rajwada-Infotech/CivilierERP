
import type { StockTransferState } from "./useStockTransfer";

// Within a company or between companies, and the source material request.
export function STModeToggle({ m }: { m: StockTransferState }) {
  const { transferMode, setTransferMode, setToCompanyId, setToProjectId, setToGodownId, items } = m;
  return (
    <>
      {/* ── Transfer Mode Toggle ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted border border-border w-fit">
          <button
            onClick={() => {
              setTransferMode("intra");
              setToCompanyId("");
              setToProjectId("");
              setToGodownId(null);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              transferMode === "intra"
                ? "bg-card shadow text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Intra-Company
          </button>
          <button
            onClick={() => {
              setTransferMode("inter");
              setToGodownId(null);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              transferMode === "inter"
                ? "bg-card shadow text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Inter-Company
          </button>
        </div>
        <span className="text-xs text-muted-foreground/60 sm:ml-auto">
          {transferMode === "intra"
            ? "Transfer between godowns within the same company"
            : "Transfer stock between different companies"}
        </span>
      </div>
    </>
  );
}
