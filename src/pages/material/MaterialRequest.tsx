// Material Request. The page is split into parts under ./materialRequest:
//   config               constants, types, small helpers
//   useMaterialRequest   all state, queries, mutations and the register columns
//   MRList               the request register
//   MRForm               create / edit
//   MRViewModal          one request opened for reading
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import { Plus, Send, Download, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaterialShell } from "@/components/material/MaterialShell";
import { EXPORT_COLUMNS } from "./materialRequest/config";
import { useMaterialRequest } from "./materialRequest/useMaterialRequest";
import { MRList } from "./materialRequest/MRList";
import { MRForm } from "./materialRequest/MRForm";
import { MRViewModal } from "./materialRequest/MRViewModal";

export default function MaterialRequest() {
  const m = useMaterialRequest();
  const { rights, importFileInputRef, importing, viewMode, setViewMode, projects, listData, loadingList, columns, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Material Request"]} />
      <MaterialShell
        title="Material Requests"
        subtitle="Request materials for projects"
        icon={Send}
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
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                <span className="hidden sm:inline">{importing ? "Importing..." : "Import CSV"}</span>
              </button>
              {rights.canCreate && (
                <Button
                  onClick={() => setViewMode("form")}
                  className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg btn-module transition-all"
                >
                  <Plus size={13} /> New Request
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {viewMode === "list" && <MRList m={m} />}
        {viewMode === "form" && <MRForm m={m} />}
        <MRViewModal m={m} />
      </MaterialShell>
    </>
  );
}
