// Excel / CSV import of received fixed-asset stock. "Bulk" keeps the Quantity column (a row can be several identical
// units); "Individual" drops it, so every row is one unit. Each valid row goes in as an Inventory Import, which then
// follows the usual FA tagging and FA Code generation.
import React, { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFinYear } from "@/contexts/FinYearContext";
import { getItems } from "@/api/itemMasterApi";
import { createInventoryImport } from "@/api/fixedAssetInventoryImportApi";
import { getActiveDepreciationSetups } from "@/api/depreciationApi";
import type { Godown } from "@/api/godownsApi";
import type { ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { downloadFaInventoryTemplate, readFaImportFile } from "../faInventoryExcel";
import { validateFaImportRows, type FaImportResultRow } from "../faImportValidation";
import { KEY_INK, KEY_LINE, LBL, RULE } from "../record/config";
import { deriveFinYear, ensureArray } from "./config";

type ImportMode = "bulk" | "individual";
const SEG = (on: boolean) =>
  `font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-full px-3 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`;

export function InventoryImport({
  companies, allProjects, godowns,
}: {
  companies: { id: number; label: string }[];
  allProjects: (ProjectCompanyLike & { id: number; label: string })[];
  godowns: Godown[];
}) {
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>("bulk");
  const [rows, setRows] = useState<FaImportResultRow[] | null>(null);
  const [done, setDone] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const liveGodowns = ensureArray<Godown>(godowns).filter((g) => !g.IsDeleted && g.IsActive);

  const downloadTemplate = async () => {
    try {
      const [items, setups] = await Promise.all([getItems(), getActiveDepreciationSetups()]);
      await downloadFaInventoryTemplate(mode, {
        assetCategories: [...new Set(setups.map((s) => s.AssetCategory.trim()).filter(Boolean))].sort(),
        companies,
        projects: allProjects,
        godowns: liveGodowns.map((g) => ({ GodownName: g.GodownName, EnterpriseID: g.EnterpriseID ?? null, ProjectID: g.ProjectID ?? null })),
        // Only Fixed Asset items can be imported, so only they are offered.
        faItems: items.filter((i) => (i.M_Type || "").trim().toLowerCase() === "fixed asset").map((i) => ({ code: i.M_code || "", name: i.M_Name || "", uom: i.M_UOM || "" })),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not make the template.");
    }
  };

  const readFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again after fixing it
    if (!file) return;
    setValidating(true);
    try {
      const rawRows = await readFaImportFile(file);
      if (rawRows.length === 0) return void toast.error("The file has no data rows.");
      const [itemMaster, setups] = await Promise.all([getItems(), getActiveDepreciationSetups()]);
      setRows(
        validateFaImportRows(rawRows, {
          mode,
          companies,
          projects: allProjects,
          godowns: liveGodowns.map((g) => ({ GodownID: g.GodownID, GodownName: g.GodownName, EnterpriseID: g.EnterpriseID, ProjectID: g.ProjectID })),
          itemMaster,
          assetCategories: [...new Set(setups.map((s) => s.AssetCategory.trim()).filter(Boolean))],
          deriveFinYear: (iso) => deriveFinYear(iso, finYears),
        }),
      );
      setDone(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file.");
    } finally {
      setValidating(false);
    }
  };

  const confirm = async () => {
    if (!rows) return;
    const valid = rows.filter((r) => r.status === "valid");
    if (!valid.length) return;
    setSubmitting(true);
    const out = [...rows];
    // One at a time, like the manual Generate IDs, so each row's error stays with that row.
    for (const row of valid) {
      const idx = out.findIndex((r) => r.row === row.row);
      try {
        const created = await createInventoryImport({
          docDate: row.docDate, companyId: row.companyId, projectId: row.projectId!, godownId: row.godownId!, itemId: row.itemId!,
          assetCategory: row.assetCategory, quantity: row.quantity, rate: row.rate, remarks: row.remarks || undefined,
        });
        out[idx] = { ...row, status: "success", tagged: created.tagged };
      } catch (err) {
        out[idx] = { ...row, status: "error", message: err instanceof Error ? err.message : "Could not be created." };
      }
    }
    setRows(out);
    setDone(true);
    setSubmitting(false);
    const ok = out.filter((r) => r.status === "success").length;
    const failed = out.length - ok;
    if (ok > 0) {
      ["fixed-asset-taggings", "fixed-asset-inventory-imports", "fixed-asset-eligible-items", "fixed-asset-pending-batches", "fixed-assets", "fa-unassigned-codes", "fixed-asset-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    }
    if (failed === 0) toast.success(`Imported ${ok} row${ok === 1 ? "" : "s"}.`);
    else if (ok === 0) toast.error(`None of the ${failed} row${failed === 1 ? "" : "s"} could be imported.`);
    else toast.warning(`Imported ${ok} of ${out.length} rows; ${failed} failed.`);
  };

  const close = () => { setRows(null); setDone(false); };
  const validCount = rows?.filter((r) => r.status === "valid").length ?? 0;

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={readFile} className="hidden" />
      <span className="inline-flex h-9 border border-foreground" role="group" aria-label="Import mode">
        <button type="button" onClick={() => setMode("bulk")} className={SEG(mode === "bulk")} title="A row can be several identical units (Quantity column)">Bulk</button>
        <button type="button" onClick={() => setMode("individual")} className={SEG(mode === "individual")} title="Every row is one unit, no Quantity column">Individual</button>
      </span>
      <button onClick={downloadTemplate} className={`${KEY_LINE} h-9 px-3`} title="The Excel template, with dropdowns from your masters">
        <Download size={13} /> <span className="hidden sm:inline">Template</span>
      </button>
      <button onClick={() => fileRef.current?.click()} disabled={validating} className={`${KEY_LINE} h-9 px-3`}>
        {validating ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {validating ? "Checking…" : "Import"}
      </button>

      <Dialog open={!!rows} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="max-w-4xl rounded-none" style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{done ? "Import results" : "Check the import"}</DialogTitle>
          </DialogHeader>
          {rows && (
            <div className="space-y-3">
              <p className={LBL}>
                {rows.filter((r) => r.status === "valid" || r.status === "success").length} {done ? "imported" : "ready"}
                {rows.some((r) => r.status === "error") && <span className="text-destructive"> · {rows.filter((r) => r.status === "error").length} {done ? "failed" : "rejected"}</span>}
              </p>
              <div className="max-h-96 overflow-auto" style={{ border: RULE }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card" style={{ borderBottom: RULE }}>
                    <tr>
                      {["Row", "Company / project", "Godown", "Item", "Date", "Qty", "Result"].map((h) => <th key={h} className={`${LBL} px-3 py-2 text-left`}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} style={{ borderTop: "1px solid hsl(var(--foreground) / 0.15)" }} className={r.status === "error" ? "bg-destructive/5" : ""}>
                        <td className="px-3 py-2 tabular-nums">{r.row}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate">{r.companyLabel} / {r.projectLabel}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate">{r.godownLabel}</td>
                        <td className="px-3 py-2 max-w-[180px] truncate" title={r.itemName}>
                          {r.itemCode ? `${r.itemCode} · ` : ""}{r.itemName}
                          {r.assetCategory ? <span className="block text-[0.625rem] text-muted-foreground">{r.assetCategory}</span> : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{r.docDate}</td>
                        <td className="px-3 py-2 tabular-nums">{r.quantity || "—"}</td>
                        <td className="px-3 py-2 min-w-[240px] whitespace-normal break-words align-top">
                          {r.status === "error" ? <span className="text-destructive">{r.message}</span>
                            : r.status === "success" ? <span>Imported{r.tagged ? ` · ${r.tagged} FA code${r.tagged === 1 ? "" : "s"}` : " · waiting to be tagged"}</span>
                            : <span>Ready</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            {!done ? (
              <>
                <button onClick={close} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                <button onClick={confirm} disabled={submitting || validCount === 0} className={`${KEY_INK} h-9 px-4`}>
                  {submitting ? "Importing…" : `Import ${validCount} row${validCount === 1 ? "" : "s"}`}
                </button>
              </>
            ) : (
              <button onClick={close} className={`${KEY_INK} h-9 px-4`}>Close</button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
