// Material Request. The page is split into parts under ./materialRequest:
//   config               constants, types, small helpers
//   useMaterialRequest   all state, queries, mutations and the register columns
//   MRList               the request register
//   MRForm               create / edit
//   MRViewModal          one request opened for reading
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import { Plus, Download, Upload, Loader2 } from "lucide-react";
import { SheetShell } from "@/components/sheet/Sheet";
import { EXPORT_COLUMNS, KEY_INK, KEY_LINE } from "./materialRequest/config";
import { useMaterialRequest } from "./materialRequest/useMaterialRequest";
import { MRList } from "./materialRequest/MRList";
import { MRForm } from "./materialRequest/MRForm";
import { MRViewModal } from "./materialRequest/MRViewModal";

export default function MaterialRequest() {
  const m = useMaterialRequest();
  const { rights, importFileInputRef, importing, viewMode, setViewMode, listData, loadingList, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Material Request"]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Material requests"
        subtitle="Materials a project asks for, from request through approval to ordering."
        action={
          viewMode === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={(listData?.data || []) as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Material Requests"
                filename="material-requests"
                disabled={loadingList || !listData?.data?.length || !rights.canExport}
              />
              <input ref={importFileInputRef} type="file" accept=".csv" onChange={handleImportFileChange} className="hidden" />
              <button onClick={handleDownloadTemplate} title="Download a blank CSV template" className={`${KEY_LINE} h-9 px-3`}>
                <Download size={12} />
                <span className="hidden sm:inline">Template</span>
              </button>
              <button onClick={handleImportClick} disabled={importing} title="Import from CSV" className={`${KEY_LINE} h-9 px-3`}>
                {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                <span className="hidden sm:inline">{importing ? "Importing…" : "Import CSV"}</span>
              </button>
              {rights.canCreate && (
                <button onClick={() => setViewMode("form")} className={`${KEY_INK} h-9 px-4`}>
                  <Plus size={13} /> New request
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {viewMode === "list" && <MRList m={m} />}
        {viewMode === "form" && <MRForm m={m} />}
        <MRViewModal m={m} />
      </SheetShell>
    </>
  );
}
