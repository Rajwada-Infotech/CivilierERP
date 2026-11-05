import React, { useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { MasterPage, type DataChangeEvent } from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getItemGroups,
  addItemGroup,
  updateItemGroup,
  deleteItemGroup,
} from "@/api/itemGroupApi";
import { toast } from "sonner";
import { Download, Upload, Loader2, Check, X } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DbItemGroup {
  M_Id: string;
  M_Name: string;
  M_Description: string | null;
  M_Type: string | null;
  M_code: string | null;
  M_BelongsTo: string | null;
  M_Group: string | null;
  M_IdentityCode: boolean | null;
  M_HSN: string | null;
  M_CGST: number | null;
  M_IGST: number | null;
  M_SGST: number | null;
  Parent_Id: string | null;
}

// ✅ M_CreatedBy removed — backend reads it from JWT token via req.user.userId
const toPayload = (record: Record<string, unknown>) => ({
  M_Name: record.Name as string,
  M_Description: record.Description as string,
  M_code: (record.Code as string) || null,
  M_Type: null,
  M_IdentityCode: false,
  M_HSN: null,
  M_CGST: null,
  M_IGST: null,
  M_SGST: null,
  // ✅ M_BelongsTo = Item Group Name (M_Name of this group itself)
  M_BelongsTo: null,
  // ✅ M_Group stays null as per your requirement
  M_Group: null,
  M_ApprovedBy: null,
  Parent_Id: null,
});

// ── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  name: "Name",
  code: "Code",
  description: "Description",
} as const;

const ITEM_GROUP_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: CSV_HEADERS.name, accessor: "name" },
  { header: CSV_HEADERS.code, accessor: "code" },
  { header: CSV_HEADERS.description, accessor: "description" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;

const ItemGroupMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("item-group");

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbItemGroup[] = Array.isArray(dbData) ? dbData : [];

  const mappedData = dbItems.map((item) => ({
    _id: String(item.M_Id),
    Name: item.M_Name || "",
    Description: item.M_Description || "",
    Code: item.M_code || "",
  }));

  // CSV import
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  // ── CSV template download ───────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv(
      [],
      ITEM_GROUP_CSV_TEMPLATE_COLUMNS,
      "item-group-master-template",
    );
    toast.success("Template downloaded — fill it in and use Import.");
  };

  // ── CSV import ───────────────────────────────────────────────────────────────
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Allow picking the same filename again later.
    e.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file.");
      return;
    }

    setImporting(true);
    setImportResults(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        toast.error("The CSV file has no data rows.");
        setImporting(false);
        return;
      }

      const results: ImportRowResult[] = [];

      // Sequential, not Promise.all — keeps row order in the result list
      // predictable and avoids hammering the API with N parallel inserts.
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const rowNum = i + 2; // +1 for header row, +1 for 1-based numbering
        const nameForLog = raw[CSV_HEADERS.name] || "(blank)";

        try {
          const name = (raw[CSV_HEADERS.name] || "").trim();
          const code = (raw[CSV_HEADERS.code] || "").trim().toUpperCase();
          const description = (raw[CSV_HEADERS.description] || "").trim();

          if (!name) throw new Error("Name is required");
          if (!code) throw new Error("Code is required");
          if (!description) throw new Error("Description is required");

          await addItemGroup(
            toPayload({ Name: name, Code: code, Description: description }),
          );
          results.push({ row: rowNum, name, status: "success" });
        } catch (err: any) {
          results.push({
            row: rowNum,
            name: nameForLog,
            status: "error",
            message: err?.message || "Unknown error",
          });
        }
      }

      setImportResults(results);
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.length - successCount;

      if (successCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ["item-groups"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} item group${successCount === 1 ? "" : "s"} ✓`,
        );
      } else if (successCount === 0) {
        toast.error(
          `Import failed for all ${errorCount} row${errorCount === 1 ? "" : "s"}.`,
        );
      } else {
        toast.warning(
          `Imported ${successCount} of ${results.length} rows — ${errorCount} failed. See details.`,
        );
      }
    } catch (err: any) {
      toast.error(
        "Could not read CSV file: " + (err?.message || "Unknown error"),
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      await addItemGroup(toPayload(event.record));
      await queryClient.invalidateQueries({ queryKey: ["item-groups"] });
    }
    if (event.action === "update") {
      await updateItemGroup(event.id, toPayload(event.record));
      await queryClient.invalidateQueries({ queryKey: ["item-groups"] });
    }
    if (event.action === "delete") {
      await deleteItemGroup(event.id);
      await queryClient.invalidateQueries({ queryKey: ["item-groups"] });
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  if (error)
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load item groups. Check your backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Material Module", "Item Group Master"]}
      />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Item groups"
        subtitle="The groups items are filed under, each with a short code."
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
              title="Download a blank CSV with all Item Group fields"
              className={`${KEY_LINE} h-9 px-3`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            {rights.canCreate && (
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import item groups from a filled-in CSV"
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
        <MasterPage
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          title="Item Group"
          fields={[
            { name: "Name", label: "Name", type: "text", required: true },
            {
              name: "Code",
              label: "Code",
              type: "text",
              required: true,
              uppercase: true,
            },
            {
              name: "Description",
              label: "Description",
              type: "text",
              required: true,
            },
          ]}
          columns={[
            { key: "Name", label: "Name" },
            { key: "Code", label: "Code" },
            { key: "Description", label: "Description" },
          ]}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={rights.canExport ? {
            title: "Item Group Master",
            filename: "item-group-master",
            columns: [
              { header: "Name", accessor: "Name" },
              { header: "Code", accessor: "Code" },
              { header: "Description", accessor: "Description" },
            ],
          } : undefined}
        />

        {/* Import Results Modal */}
        <Dialog
          open={!!importResults}
          onOpenChange={(open) => !open && setImportResults(null)}
        >
          <DialogContent className="sheet-frame max-w-lg p-0 gap-0" style={{ margin: 0 }}>
            <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Item groups</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Import results</DialogTitle>
            </DialogHeader>
            {importResults && (
              <div className="space-y-3 px-5 pt-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <Check size={14} />
                    {
                      importResults.filter((r) => r.status === "success").length
                    }{" "}
                    succeeded
                  </span>
                  {importResults.some((r) => r.status === "error") && (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <X size={14} />
                      {
                        importResults.filter((r) => r.status === "error").length
                      }{" "}
                      failed
                    </span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto border border-foreground divide-y divide-foreground/10">
                  {importResults.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 px-3 py-2 text-sm ${
                        r.status === "error" ? "bg-destructive/5" : ""
                      }`}
                    >
                      {r.status === "success" ? (
                        <Check
                          size={14}
                          className="text-foreground shrink-0 mt-0.5"
                        />
                      ) : (
                        <X
                          size={14}
                          className="text-destructive shrink-0 mt-0.5"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          Row {r.row} — {r.name}
                        </p>
                        {r.message && (
                          <p className="text-xs text-destructive">
                            {r.message}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 px-5 py-4">
              <button
                onClick={() => setImportResults(null)}
                className={`${KEY_INK} h-9 px-4`}
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default ItemGroupMaster;
