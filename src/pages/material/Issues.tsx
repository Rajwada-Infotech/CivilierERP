// Material Issues. The page is split into parts under ./issues:
//   config     constants, types, field / godown badge / work-order comparison
//   useIssues  all state, queries, cart, mutations, CSV import
//   list:  IssueList          form:  IssueFormHeader, IssueCart, IssueFormFooter
//   view:  IssueViewOverlay, IssueDeleteDialog, IssueImportDialog
import { IssueDeleteDialog } from "./issues/IssueDeleteDialog";
import { IssueImportDialog } from "./issues/IssueImportDialog";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { Plus, Download, Upload, Loader2 } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { ISSUES_EXPORT_COLUMNS, KEY_INK, KEY_LINE, defaultHeader, blankCartItem } from "./issues/config";
import { useIssues } from "./issues/useIssues";
import { IssueList } from "./issues/IssueList";
import { IssueFormHeader } from "./issues/IssueFormHeader";
import { IssueCart } from "./issues/IssueCart";
import { IssueFormFooter } from "./issues/IssueFormFooter";
import { IssueViewOverlay } from "./issues/IssueViewOverlay";

export default function Issues() {
  const m = useIssues();
  const { rights, importFileInputRef, importing, viewMode, setViewMode, setEditingId, setHeader, setCart, projects, issuesData, loadingIssues, columns, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Issues"]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Material issues"
        subtitle="Material issued from a godown to its project, checked against the stock in that godown."
        action={
          viewMode === "list" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <ExportMenu
                data={(issuesData?.data || []) as unknown as Record<string, unknown>[]}
                columns={ISSUES_EXPORT_COLUMNS}
                title="Material Issues"
                filename="material-issues"
                disabled={loadingIssues || !(issuesData?.data?.length) || !rights.canExport}
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
{rights.canCreate && (
                <button
                  onClick={handleImportClick}
                  disabled={importing}
                  title="Import from CSV"
                  className={`${KEY_LINE} h-9 px-3`}
                >
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  <span className="hidden sm:inline">{importing ? "Reading…" : "Import CSV"}</span>
                </button>
              )}
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setHeader(defaultHeader);
                    setCart([blankCartItem()]);
                    setEditingId(null);
                    setViewMode("form");
                  }}
                  className={`${KEY_INK} h-9 px-4`}
                >
                  <Plus size={13} /> New Issue
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {viewMode === "list" && <IssueList m={m} />}
        {viewMode === "form" && (
          <div className="space-y-5">
            <IssueFormHeader m={m} />
            <IssueCart m={m} />
            <IssueFormFooter m={m} />
          </div>
        )}
        <IssueViewOverlay m={m} />
        <IssueDeleteDialog m={m} />
        {m.importPlan && (
          <IssueImportDialog
            fileName={m.importPlan.fileName}
            plan={m.importPlan.plan}
            onClose={() => m.setImportPlan(null)}
            onCreated={() => m.queryClient.invalidateQueries({ queryKey: ["issues-list"] })}
          />
        )}
      </SheetShell>
    </>
  );
}
