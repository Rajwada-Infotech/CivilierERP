// GRN (goods receipt note). The page is split into parts under ./grn:
//   config   constants, small parts (panels, cards, pills), register columns, the bridge
//   useGRN   all state, queries, PO lines, attachments, print, mutations
//   form:  GRNFormHeader, GRNPoSection, GRNDates, GRNItems, GRNRemarks, GRNFormActions
//   list:  GRNHistory, GRNViewModal, GRNDebitNote, GRNDeleteBlockDialog, GRNDeleteConfirmDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { Plus, Download, Upload, Loader2 } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { GRN_EXPORT_COLUMNS, KEY_INK, KEY_LINE, RULE } from "./grn/config";
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
        <div className="w-4 h-4 border-2 border-foreground/40 border-t-transparent animate-spin" />
        Loading GRNs…
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN"]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Goods receipt notes"
        subtitle="Goods received against purchase orders: what arrived, its quality, and what is still to come."
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
                className={`${KEY_LINE} h-9 px-3`}
              >
                <Download size={13} />
                <span className="hidden sm:inline">Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className={`${KEY_LINE} h-9 px-3`}
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
                  className={`${KEY_INK} h-9 px-4`}
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
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
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
      </SheetShell>

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
