
import type { StockTransferState } from "./useStockTransfer";

const MODE = (on: boolean) =>
  `font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-8 px-3 border transition-colors ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

// Within a company or between companies, and the source material request.
export function STModeToggle({ m }: { m: StockTransferState }) {
  const { transferMode, setTransferMode, setToCompanyId, setToProjectId, setToGodownId, items } = m;
  return (
    <>
      {/* ── Transfer Mode Toggle ─────────────────────────────────────────── */}
      <div className="border border-foreground bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-2 w-fit">
          <button
            onClick={() => {
              setTransferMode("intra");
              setToCompanyId("");
              setToProjectId("");
              setToGodownId(null);
            }}
            className={MODE(transferMode === "intra")}
          >
            Intra-Company
          </button>
          <button
            onClick={() => {
              setTransferMode("inter");
              setToGodownId(null);
            }}
            className={MODE(transferMode === "inter")}
          >
            Inter-Company
          </button>
        </div>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {transferMode === "intra"
            ? "Transfer between godowns within the same company"
            : "Transfer stock between different companies"}
        </span>
      </div>
    </>
  );
}
