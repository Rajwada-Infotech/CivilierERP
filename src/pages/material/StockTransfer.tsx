// Stock Transfer: moving stock between godowns, within a company or to another company.
// The page is split into parts under ./stockTransfer:
//   config            formats, line types, the blank line
//   useStockTransfer  all state, queries, the route, lines and stock, MR source, inter-company pricing, mutations
//   form:  STModeToggle, STRoute, STItems      pickers: FilterSelect, GodownSelect, ItemSearchRow, FaCodePicker
//   history:  TransferHistory, TransferPreviewModal, ICTPreviewModal, MakeGRNModal
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AlertCircle, CheckCircle2, X, ClipboardList, Send, ArrowLeftRight } from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { TransferHistory } from "./stockTransfer/TransferHistory";
import { useStockTransfer } from "./stockTransfer/useStockTransfer";
import { STModeToggle } from "./stockTransfer/STModeToggle";
import { STRoute } from "./stockTransfer/STRoute";
import { STItems } from "./stockTransfer/STItems";

export default function StockTransfer() {
  const m = useStockTransfer();
  const { activeTab, setActiveTab, fromGodownId, items, successMsg, setSuccessMsg, errorMsg, setErrorMsg } = m;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock Transfer"]} />

      <MaterialShell
        title="Stock Transfer"
        subtitle="Transfer stock between godowns"
        icon={ArrowLeftRight}
      >
        {/* Tab toggle */}
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border border-border w-fit">
          <button
            onClick={() => setActiveTab("transfer")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "transfer"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Send size={13} /> New Transfer
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "history"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardList size={13} /> History
          </button>
        </div>

        {activeTab === "history" && <TransferHistory />}

        {activeTab === "transfer" && (
          <div className="space-y-4">
            {successMsg && (
              <div className="px-4 py-3 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-2 text-sm">
                <CheckCircle2 size={15} /> {successMsg}
                <button onClick={() => setSuccessMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}
            {errorMsg && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 flex items-center gap-2 text-sm">
                <AlertCircle size={15} /> {errorMsg}
                <button onClick={() => setErrorMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}

            <STModeToggle m={m} />

            <STRoute m={m} />

            <STItems m={m} />

            {!fromGodownId && (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 py-20 text-center">
                <ArrowLeftRight
                  size={36}
                  className="text-muted-foreground/30 mx-auto mb-3"
                />
                <p className="text-sm text-muted-foreground">
                  Select a source godown to begin a transfer
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Use the filters above to narrow godowns by company or project
                </p>
              </div>
            )}
          </div>
        )}
      </MaterialShell>
    </>
  );
}
