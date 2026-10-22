// Item Master. The page is split into parts under ./itemMaster:
//   config         types, row <-> form conversions, CSV columns, HSN dropdown, field wrapper
//   useItemMaster  all state, masters, form, save / delete, short-code fixes, CSV import
//   IMForm · IMTable · IMViewDialog · IMImportDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { Check, Loader2, Download, Upload } from "lucide-react";
import { DuplicateShortCodesPanel } from "./DuplicateShortCodesPanel";
import { Item } from "./itemMaster/config";
import { useItemMaster } from "./itemMaster/useItemMaster";
import { IMForm } from "./itemMaster/IMForm";
import { IMTable } from "./itemMaster/IMTable";
import { IMViewDialog } from "./itemMaster/IMViewDialog";
import { IMImportDialog } from "./itemMaster/IMImportDialog";

const KEY_LINE =
  "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 border border-foreground text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

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
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Items"
        subtitle="The item catalogue: group, units, HSN and tax, accounts and suppliers for everything bought, stocked and issued."
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
              className={`${KEY_LINE} h-9 px-3`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            {rights.canCreate && (
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import items from a filled-in CSV"
                className={`${KEY_LINE} h-9 px-3`}
              >
                {importing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                <span className="hidden sm:inline">
                  {importing ? "Importing…" : "Import CSV"}
                </span>
              </button>
            )}
          </div>
        }
      >
        <IMForm m={m} />

        {/* ── Short codes used by more than one item ── */}
        <DuplicateShortCodesPanel items={data} canEdit={rights.canEdit} onRename={handleRenameDuplicate} />

        <IMTable m={m} />

        <IMViewDialog m={m} />

        <IMImportDialog m={m} />
      </SheetShell>
    </>
  );
}
