// Vehicle In/Out. The page is split into parts under ./vehicleInOut:
//   config            constants, small parts (cards, pills, thumbnails), register columns
//   useVehicleInOut   all state, queries, PO link, attachments, camera, print, mutations
//   form:  VIOFormHeader, VIODocInfo, VIOPoSupplier, VIOVehicleDetails, VIOFormActions
//   list:  VIORegister, VIOViewModal, VIODebitNote, VIOPoPreview, VIOCamera, VIODeleteDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { ExportMenu } from "@/components/ExportMenu";
import { Plus, Download, Upload, Loader2 } from "lucide-react";
import { VIO_EXPORT_COLUMNS, buildEmpty, KEY_INK, KEY_LINE, RULE } from "./vehicleInOut/config";
import { useVehicleInOut } from "./vehicleInOut/useVehicleInOut";
import { VIOFormHeader } from "./vehicleInOut/VIOFormHeader";
import { VIODocInfo } from "./vehicleInOut/VIODocInfo";
import { VIOPoSupplier } from "./vehicleInOut/VIOPoSupplier";
import { VIOVehicleDetails } from "./vehicleInOut/VIOVehicleDetails";
import { VIOFormActions } from "./vehicleInOut/VIOFormActions";
import { VIORegister } from "./vehicleInOut/VIORegister";
import { VIOViewModal } from "./vehicleInOut/VIOViewModal";
import { VIODebitNote } from "./vehicleInOut/VIODebitNote";
import { VIOPoPreview } from "./vehicleInOut/VIOPoPreview";
import { VIOCamera } from "./vehicleInOut/VIOCamera";
import { VIODeleteDialog } from "./vehicleInOut/VIODeleteDialog";

export default function VehicleInOut() {
  const m = useVehicleInOut();
  const { rights, activeFinYear, importFileInputRef, importing, showForm, setShowForm, setEditingId, setErrors, setReceivedQtyByItem, setPhotoByItem, setQualityByItem, setBrandByItem, setForm, records, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  if (m.isLoading) {
    return (
      <div className="flex items-center gap-2.5 mt-8 text-muted-foreground text-sm">
        <div className="w-4 h-4 border-2 border-foreground border-t-transparent animate-spin" />
        Loading Vehicle In/Out…
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Vehicle In/Out"]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Vehicle in / out"
        subtitle="Vehicles arriving at site against purchase orders: what they carried, what was received and its quality."
        action={
          !showForm ? (
            <div className="flex items-center gap-2 flex-wrap">
              <ExportMenu
                data={records as unknown as Record<string, unknown>[]}
                columns={VIO_EXPORT_COLUMNS}
                title="Vehicle In/Out"
                filename="vehicle-in-out"
                disabled={!records.length || !rights.canExport}
              />
              <input ref={importFileInputRef} type="file" accept=".csv" onChange={handleImportFileChange} className="hidden" />
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
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                <span className="hidden sm:inline">{importing ? "Importing..." : "Import CSV"}</span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setShowForm(true);
                    setEditingId(null);
                    setForm(buildEmpty(activeFinYear));
                    setReceivedQtyByItem({});
                    setPhotoByItem({});
                    setQualityByItem({});
                    setBrandByItem({});
                    setErrors({});
                  }}
                  className={`${KEY_INK} h-9 px-4`}
                >
                  <Plus size={13} /> New entry
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* FORM                                                                */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {showForm && (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <VIOFormHeader m={m} />

            <div className="p-5 space-y-5">
              <VIODocInfo m={m} />

              <VIOPoSupplier m={m} />

              <VIOVehicleDetails m={m} />

              <VIOFormActions m={m} />
            </div>
          </div>
        )}

        {!showForm && <VIORegister m={m} />}

      </SheetShell>

        <VIOViewModal m={m} />

      <VIODebitNote m={m} />

      <VIOPoPreview m={m} />

      <VIOCamera m={m} />

      <VIODeleteDialog m={m} />
    </>
  );
}
