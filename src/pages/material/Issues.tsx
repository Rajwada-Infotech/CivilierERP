// Material Issues. The page is split into parts under ./issues:
//   config     constants, types, field / godown badge / work-order comparison
//   useIssues  all state, queries, cart, mutations, CSV import
//   list:  IssueList          form:  IssueFormHeader, IssueCart, IssueFormFooter
//   view:  IssueViewOverlay
import { IssueImportDialog } from "./issues/IssueImportDialog";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { Plus, ArrowDownToLine, Download, Upload, Loader2 } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { Button } from "@/components/ui/button";
import { ISSUES_EXPORT_COLUMNS, defaultHeader, blankCartItem } from "./issues/config";
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
      <MaterialShell
        title="Material Issues"
        subtitle="Issue materials from godown to projects"
        icon={ArrowDownToLine}
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
                  onClick={() => {
                    setHeader(defaultHeader);
                    setCart([blankCartItem()]);
                    setEditingId(null);
                    setViewMode("form");
                  }}
                  className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg btn-module transition-all"
                >
                  <Plus size={15} /> New Issue
                </Button>
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
        {m.importPlan && (
          <IssueImportDialog
            fileName={m.importPlan.fileName}
            plan={m.importPlan.plan}
            onClose={() => m.setImportPlan(null)}
            onCreated={() => m.queryClient.invalidateQueries({ queryKey: ["issues-list"] })}
          />
        )}
      </MaterialShell>
    </>
  );
}
