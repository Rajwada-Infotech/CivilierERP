// Issue Return: material coming back from a project to the godown it was issued from.
// The page is split into parts under ./issueReturn:
//   config          constants, types, styles, the API helper
//   useIssueReturn  all state, queries, the form's issue lines, mutations, CSV import
//   IRList (register) · IRForm (new / edit) · IRDetail (one return) · IRDeleteDialog · IRImportDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { ExportMenu } from "@/components/ExportMenu";
import { Download, Loader2, Plus, Upload } from "lucide-react";
import { ISSUE_RETURN_EXPORT_COLUMNS, KEY_INK, KEY_LINE } from "./issueReturn/config";
import { useIssueReturn } from "./issueReturn/useIssueReturn";
import { IRList } from "./issueReturn/IRList";
import { IRForm } from "./issueReturn/IRForm";
import { IRDetail } from "./issueReturn/IRDetail";
import { IRDeleteDialog } from "./issueReturn/IRDeleteDialog";
import { IRImportDialog } from "./issueReturn/IRImportDialog";

export default function IssueReturn() {
  const m = useIssueReturn();
  const { view, rights, rows, filtered, importFileInputRef, importing, importPlan, setImportPlan, qc, openNew, handleDownloadTemplate, handleImportFileChange } = m;

  return (
    <>
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "Issue Return" }]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Issue returns"
        subtitle="Material coming back from a project into the godown it was issued from, capped at what is still out on the issue."
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={filtered as unknown as Record<string, unknown>[]}
                columns={ISSUE_RETURN_EXPORT_COLUMNS}
                title="Issue Returns"
                filename="issue-returns"
                disabled={!rows.length || !rights.canExport}
              />
              <input ref={importFileInputRef} type="file" accept=".csv" onChange={handleImportFileChange} className="hidden" />
              <button onClick={handleDownloadTemplate} title="Download a blank CSV template" className={`${KEY_LINE} h-9 px-3`}>
                <Download size={13} />
                <span className="hidden sm:inline">Template</span>
              </button>
              {rights.canCreate && (
                <button onClick={() => importFileInputRef.current?.click()} disabled={importing} title="Import from CSV" className={`${KEY_LINE} h-9 px-3`}>
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  <span className="hidden sm:inline">{importing ? "Reading…" : "Import CSV"}</span>
                </button>
              )}
              {rights.canCreate && (
                <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}>
                  <Plus size={13} /> New return
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {view === "list" ? <IRList m={m} /> : <IRForm m={m} />}
      </SheetShell>

      <IRDetail m={m} />
      <IRDeleteDialog m={m} />
      {importPlan && (
        <IRImportDialog
          fileName={importPlan.fileName}
          plan={importPlan.plan}
          onClose={() => setImportPlan(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["issue-returns"] })}
        />
      )}
    </>
  );
}
