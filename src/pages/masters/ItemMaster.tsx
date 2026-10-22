// Item Master. The page is split into parts under ./itemMaster:
//   config         types, row <-> form conversions, CSV columns, HSN dropdown, field wrapper
//   useItemMaster  all state, masters, form, save / delete, short-code fixes, CSV import
//   IMForm · IMTable · IMViewDialog · IMImportDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { Check, Loader2, Package, Download, Upload } from "lucide-react";
import { DuplicateShortCodesPanel } from "./DuplicateShortCodesPanel";
import { Item } from "./itemMaster/config";
import { useItemMaster } from "./itemMaster/useItemMaster";
import { IMForm } from "./itemMaster/IMForm";
import { IMTable } from "./itemMaster/IMTable";
import { IMViewDialog } from "./itemMaster/IMViewDialog";
import { IMImportDialog } from "./itemMaster/IMImportDialog";

export default function ItemMaster() {
  const m = useItemMaster();
  const { rights, data, importFileInputRef, importing, handleRenameDuplicate, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  if (m.isLoading)
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading items...
      </div>
    );
  if (m.error)
    return (
      <div className="p-8 text-destructive">
        Failed to load items. Check your backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Item Master"]} />
      <MaterialShell
        title="Item Master"
        subtitle="Manage your item catalog"
        icon={Package}
        action={
          <div className="flex items-center gap-2">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV with all Item Master fields"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Download Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import items from a filled-in CSV"
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
          </div>
        }
      >
        <IMForm m={m} />

        {/* ── Short codes used by more than one item ── */}
        <DuplicateShortCodesPanel items={data} canEdit={rights.canEdit} onRename={handleRenameDuplicate} />

        <IMTable m={m} />

        <IMViewDialog m={m} />

        <IMImportDialog m={m} />
      </MaterialShell>
    </>
  );
}
