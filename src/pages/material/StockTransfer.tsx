// Stock Transfer: moving stock between godowns, within a company or to another company.
// The page is split into parts under ./stockTransfer:
//   config            formats, line types, the blank line
//   useStockTransfer  all state, queries, the route, lines and stock, MR source, inter-company pricing, mutations
//   form:  STModeToggle, STRoute, STItems      pickers: FilterSelect, GodownSelect, ItemSearchRow, FaCodePicker
//   history:  TransferHistory, TransferPreviewModal, ICTPreviewModal, MakeGRNModal
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AlertCircle, CheckCircle2, X, ClipboardList, Send, ArrowLeftRight } from "lucide-react";
import { SheetShell } from "@/components/sheet/Sheet";
import { TransferHistory } from "./stockTransfer/TransferHistory";
import { useStockTransfer } from "./stockTransfer/useStockTransfer";
import { STModeToggle } from "./stockTransfer/STModeToggle";
import { STRoute } from "./stockTransfer/STRoute";
import { STItems } from "./stockTransfer/STItems";

const TAB = (on: boolean) =>
  `font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center gap-1.5 h-8 px-3 border transition-colors ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

export default function StockTransfer() {
  const m = useStockTransfer();
  const { activeTab, setActiveTab, fromGodownId, items, successMsg, setSuccessMsg, errorMsg, setErrorMsg } = m;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock Transfer"]} />

      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Stock transfer"
        subtitle="Move stock between godowns, within a company or to another company, checked against what the source godown holds."
      >
        {/* Tab toggle */}
        <div className="flex items-center gap-2">
          {([["transfer", "New transfer", Send], ["history", "History", ClipboardList]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setActiveTab(key)} className={TAB(activeTab === key)}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {activeTab === "history" && <TransferHistory />}

        {activeTab === "transfer" && (
          <div className="space-y-4">
            {successMsg && (
              <div className="px-4 py-3 bg-card text-foreground border border-foreground/40 flex items-center gap-2 text-sm">
                <CheckCircle2 size={15} /> {successMsg}
                <button onClick={() => setSuccessMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}
            {errorMsg && (
              <div className="px-4 py-3 bg-destructive/10 text-destructive border border-destructive flex items-center gap-2 text-sm">
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
              <div className="border border-dashed border-foreground/30 bg-card py-20 text-center">
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
      </SheetShell>
    </>
  );
}
