// GRN (goods receipt note). The page is split into parts under ./grn:
//   config   constants, small parts (panels, cards, pills), register columns, the bridge
//   useGRN   all state, queries, PO lines, attachments, print, mutations
//   form:  GRNFormHeader, GRNPoSection, GRNDates, GRNItems, GRNRemarks, GRNFormActions
//   list:  GRNHistory, GRNViewModal, GRNDebitNote, GRNDeleteBlockDialog, GRNDeleteConfirmDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { Truck, Receipt, Plus, Download, Upload, Loader2 } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { GRN_EXPORT_COLUMNS } from "./grn/config";
import { useGRN } from "./grn/useGRN";
import { GRNFormHeader } from "./grn/GRNFormHeader";
import { GRNPoSection } from "./grn/GRNPoSection";
import { GRNDates } from "./grn/GRNDates";
import { GRNItems } from "./grn/GRNItems";
import { GRNRemarks } from "./grn/GRNRemarks";
import { GRNFormActions } from "./grn/GRNFormActions";
import { GRNHistory } from "./grn/GRNHistory";
import { GRNViewModal } from "./grn/GRNViewModal";
import { GRNDebitNote } from "./grn/GRNDebitNote";
import { GRNDeleteBlockDialog } from "./grn/GRNDeleteBlockDialog";
import { GRNDeleteConfirmDialog } from "./grn/GRNDeleteConfirmDialog";

export default function GRN() {
  const m = useGRN();
  const { rights, importFileInputRef, importing, setEditingId, showForm, setShowForm, buildEmptyForm, setFormData, setErrors, grns, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  if (m.loadingGrns) {
    return (
      <div className="flex items-center gap-2.5 mt-8 text-muted-foreground text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        Loading GRNs…
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN"]} />
      <MaterialShell
        title="Goods Receipt Note"
        subtitle="Record goods received against purchase orders"
        icon={Truck}
        action={
          !showForm ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={grns as unknown as Record<string, unknown>[]}
                columns={GRN_EXPORT_COLUMNS}
                title="Goods Receipt Notes"
                filename="grn"
                disabled={!grns.length || !rights.canExport}
              />
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportFileChange}
                className="hidden"
              />
              <button
                onClick={handleDownloadTemplate}
                title="Download a blank CSV template"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold btn-module text-white hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                <span className="hidden sm:inline">
                  {importing ? "Importing..." : "Import CSV"}
                </span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setShowForm(true);
                    setEditingId(null);
                    setFormData(buildEmptyForm());
                    setErrors({});
                  }}
                  className="btn-module inline-flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                >
                  <Plus size={13} /> New GRN
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  FORM                                                              */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {showForm && (
          <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
            <GRNFormHeader m={m} />

            <div className="p-5 space-y-5">
              <GRNPoSection m={m} />

              <GRNDates m={m} />

              <GRNItems m={m} />

              <GRNRemarks m={m} />

              <GRNFormActions m={m} />
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  GRN HISTORY                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {!showForm && (
          <GRNHistory m={m} />
        )}
      </MaterialShell>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/*  VIEW MODAL                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <GRNViewModal m={m} />

      <GRNDebitNote m={m} />

      <GRNDeleteBlockDialog m={m} />

      <GRNDeleteConfirmDialog m={m} />
    </>
  );
}
