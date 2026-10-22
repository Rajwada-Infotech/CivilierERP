// Everything the Item Master page holds: the item list, masters (groups, UOMs, HSN, suppliers, GL heads,
// cost centres), the form, save / delete, short-code fixes and CSV import.
import React, { useState, useCallback, useRef } from "react";
import { safeHtml } from "@/utils/escapeHtml";
import { Edit2, Trash2, Check, X, Eye, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItems, addItem, updateItem, deleteItem } from "@/api/itemMasterApi";
import { getItemUomAlternates, saveItemUomAlternates } from "@/api/itemUomAlternatesApi";
import { type ColumnDef } from "@/components/ui/DataTable";
import { getItemGroups } from "@/api/itemGroupApi";
import { getUomList } from "@/api/uomApi";
import { getHsn } from "@/api/hsnApi";
import { usePageRights } from "@/hooks/usePageRights";
import { suggestFreeShortCode } from "../itemShortCodes";
import { exportToCsv, parseCsv } from "@/lib/export";
import { Checkbox } from "@/components/ui/checkbox";
import { type AlternateUomRow } from "../ItemUomAlternatesEditor";
import { GLAccountSelect } from "@/components/finance/GLAccountSelect";
import { HsnCode, Item, dbToItem, itemToPayload, EMPTY_FORM, CSV_HEADERS, ITEM_CSV_TEMPLATE_COLUMNS, ImportRowResult } from "./config";

export function useItemMaster() {
  const queryClient = useQueryClient();
  const rights = usePageRights("item-master");

  // ── Queries ──────────────────────────────────────────────────────────────
  const {
    data: dbItems = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
    staleTime: 5 * 60 * 1000,
  });
  const { data: dbGroups = [] } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
    staleTime: 5 * 60 * 1000,
  });
  const { data: dbUoms = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUomList,
    staleTime: 5 * 60 * 1000,
  });
  const { data: dbHsn = [] } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mapped options ────────────────────────────────────────────────────────
  const itemGroups = Array.isArray(dbGroups)
    ? dbGroups.map((g: any) => ({
        id: String(g.M_Id),
        description: g.M_Name || "",
        code: g.M_Group || "",
      }))
    : [];

  const uomOptions = Array.isArray(dbUoms)
    ? dbUoms
        .filter((u: any) => u.IsActive !== false)
        .map((u: any) => ({
          value: u.UOMCode,
          label: u.Symbol ? `${u.UOMName} (${u.Symbol})` : u.UOMName,
        }))
    : [];

  // Goods / Fixed Asset items take plain HSN codes; a Service item takes
  // SAC codes (the SAC-flagged rows of the same master).
  const toHsnCode = (h: any): HsnCode => ({
    code: h.HCode || "",
    description: h.HShortDescription || h.HDescription || "",
    cgstRate: h.HCGST ?? 0,
    sgstRate: h.HSGST ?? 0,
    igstRate: h.HIGST ?? 0,
  });
  const activeHsnRows: any[] = Array.isArray(dbHsn) ? dbHsn.filter((h: any) => h.HStatus !== false) : [];
  const hsnCodes: HsnCode[] = activeHsnRows.filter((h: any) => h.HIsSAC !== true).map(toHsnCode);
  const sacCodes: HsnCode[] = activeHsnRows.filter((h: any) => h.HIsSAC === true).map(toHsnCode);
  const codesFor = (itemType: string): HsnCode[] => (itemType === "Service" ? sacCodes : hsnCodes);

  // Fetch supplier list from AccountHeadMaster where LHeadType = 'S'
  const { data: dbSuppliers = [] } = useQuery({
    queryKey: ["suppliers-for-item-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/account-head/options?type=S,V&excludeCategory=Landlord");
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const supplierOptions = (Array.isArray(dbSuppliers) ? dbSuppliers : []).map(
    (s: any) => ({
      value: String(s.id ?? ""),
      label: s.label ?? "",
    }),
  );

  // Cost Centre master options — for the item-level Cost Centre tag, which
  // Purchase Order auto-fills its own Cost Centre from (see
  // PurchaseOrderMaster.tsx handleItemSelect).
  const { data: dbCostCenters = [] } = useQuery({
    queryKey: ["cost-centers-for-item-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/cost-center/options");
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const costCenterOptions = (Array.isArray(dbCostCenters) ? dbCostCenters : []).map(
    (c: any) => ({
      value: String(c.id ?? ""),
      label: c.label ?? "",
    }),
  );

  // GL Account master options — mirrors what GLAccountSelect fetches
  // internally, but this page also needs the raw list itself to resolve a
  // "GL Account" name/code typed in a CSV import row (GLAccountSelect only
  // exposes a picker UI, not a lookup API).
  const { data: dbGlAccounts = [] } = useQuery({
    queryKey: ["gl-accounts-for-item-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/general-ledger/options");
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const data: Item[] = (Array.isArray(dbItems) ? dbItems : []).map(dbToItem);

  // ── Local state ───────────────────────────────────────────────────────────
  const [form, setFormState] = useState<Omit<Item, "_id">>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewRow, setViewRow] = useState<Item | null>(null);

  // Bulk selection — cleared whenever the search filter changes so a
  // selection never silently carries over onto rows that are no longer
  // visible (deleting something you can't currently see would be surprising).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Alternate UOMs — entered inline on the form itself (create or edit) via
  // the "+" beside the UOM select, not gated behind a saved itemId. Kept
  // outside the Item/EMPTY_FORM shape since it isn't a Item_Master_Group
  // column — it's persisted separately via saveItemUomAlternates() below.
  const [alternateUoms, setAlternateUoms] = useState<AlternateUomRow[]>([]);
  const [showAlternateUoms, setShowAlternateUoms] = useState(false);
  const [loadingAlternateUoms, setLoadingAlternateUoms] = useState(false);

  // CSV import
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const set = useCallback(
    (key: keyof Omit<Item, "_id">, val: unknown) => {
      setFormState((p) => {
        const next = { ...p, [key]: val };
        if (key === "hsnCode") {
          const hsn = codesFor(next.itemType).find((h) => h.code === val);
          if (hsn) {
            next.cgst = hsn.cgstRate ?? 0;
            next.sgst = hsn.sgstRate ?? 0;
            next.igst = hsn.igstRate ?? 0;
          } else {
            next.cgst = 0;
            next.sgst = 0;
            next.igst = 0;
          }
        }
        // Switching between Service (SAC codes) and Goods (HSN codes): a code that
        // belongs to the other list is dropped, along with the GST rates it set.
        if (key === "itemType" && next.hsnCode && !codesFor(String(val)).some((h) => h.code === next.hsnCode)) {
          next.hsnCode = "";
          next.cgst = 0;
          next.sgst = 0;
          next.igst = 0;
        }
        return next;
      });
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors, hsnCodes, sacCodes],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.itemName.trim()) errs.itemName = true;
    if (!form.shortCode.trim()) errs.shortCode = true;
    if (!form.itemType) errs.itemType = true;
    if (!form.belongsTo) errs.belongsTo = true;
    // Short codes are unique across items. The server enforces it too; this is the quick answer.
    const code = form.shortCode.trim().toUpperCase();
    if (code && !errs.shortCode) {
      const own = editingId ? data.find((r) => r._id === editingId) : undefined;
      const unchanged = !!own && (own.shortCode || "").trim().toUpperCase() === code;
      const clash = unchanged
        ? undefined
        : data.find((r) => r._id !== editingId && (r.shortCode || "").trim().toUpperCase() === code);
      if (clash) {
        errs.shortCode = true;
        toast.error(`Short code "${form.shortCode.trim()}" is already used by "${clash.itemName}". Each item needs its own short code.`);
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Alternate UOMs are entered on the form (create or edit) before an
  // itemId necessarily exists yet, so validate + persist them separately
  // from the item's own fields, after the item id is known.
  const validateAlternateUoms = () => {
    const invalid = alternateUoms.find(
      (r) => !r.uomCode || !(parseFloat(r.conversionFactor) > 0),
    );
    if (invalid) {
      toast.error("Every alternate UOM needs a positive conversion factor.");
      return false;
    }
    const codes = new Set(alternateUoms.map((r) => r.uomCode));
    if (codes.size !== alternateUoms.length) {
      toast.error("Each alternate UOM can only be tagged once.");
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!validateAlternateUoms()) return;
    setSaving(true);
    try {
      const groupName =
        itemGroups.find((g) => g.id === form.belongsTo)?.description || "";
      const itemId = editingId
        ? editingId
        : (await addItem(itemToPayload(form, groupName))).M_Id;
      if (editingId) {
        await updateItem(editingId, itemToPayload(form, groupName));
      }
      if (itemId) {
        await saveItemUomAlternates(
          itemId,
          alternateUoms.map((r) => ({
            UOMCode: r.uomCode,
            ConversionFactor: parseFloat(r.conversionFactor),
          })),
        );
      }
      toast.success(
        editingId ? "Item updated successfully ✓" : "Item saved successfully ✓",
      );
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["item-master"] });
      await queryClient.invalidateQueries({ queryKey: ["item-uom-alternates"] });
      setFormState(EMPTY_FORM);
      setAlternateUoms([]);
      setShowAlternateUoms(false);
      setErrors({});
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    const { _id, ...rest } = row;
    setFormState(rest);
    setEditingId(id);
    setAlternateUoms([]);
    setShowAlternateUoms(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setLoadingAlternateUoms(true);
    try {
      const existing = await getItemUomAlternates(id);
      setAlternateUoms(
        existing.map((a) => ({
          uomCode: a.uomCode,
          conversionFactor: String(a.conversionFactor),
        })),
      );
      if (existing.length > 0) setShowAlternateUoms(true);
    } catch {
      // Non-fatal — the item itself still loaded fine, alternates just
      // won't pre-populate; the user can re-add them if needed.
    } finally {
      setLoadingAlternateUoms(false);
    }
  };

  // From the "duplicate short codes" list: opens the item in the form with a free short code already filled
  // in (A → A2), for the person to accept or change before saving.
  const handleRenameDuplicate = async (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    const suggestion = suggestFreeShortCode(row.shortCode, data);
    await handleEdit(id);
    setFormState((prev) => ({ ...prev, shortCode: suggestion }));
    toast.info(
      `"${row.shortCode}" is shared with another item. "${suggestion}" is filled in — change it if you like, then save.`,
    );
  };

  const handleDelete = async (id: string) => {
    if (editingId === id) {
      setEditingId(null);
      setFormState(EMPTY_FORM);
      setAlternateUoms([]);
      setShowAlternateUoms(false);
    }
    try {
      await deleteItem(id);
      toast.success("Item deleted");
      await queryClient.invalidateQueries({ queryKey: ["item-master"] });
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
    setDeleteConfirmId(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setSelectedIds(new Set());
  };

  // Sequential, not Promise.all — same reasoning as the CSV importer above:
  // keeps failures attributable to a specific item and avoids hammering the
  // API with N parallel deletes. An item still referenced elsewhere (a PO
  // line, a GRN, etc.) fails its own delete without blocking the rest.
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    let successCount = 0;
    const failures: { itemName: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await deleteItem(id);
        successCount++;
        if (editingId === id) {
          setEditingId(null);
          setFormState(EMPTY_FORM);
          setAlternateUoms([]);
          setShowAlternateUoms(false);
        }
      } catch (err: any) {
        const itemName = data.find((r) => r._id === id)?.itemName || id;
        failures.push({ itemName, message: err?.message || "Delete failed" });
      }
    }
    if (successCount > 0) {
      await queryClient.invalidateQueries({ queryKey: ["item-master"] });
    }
    if (failures.length === 0) {
      toast.success(`Deleted ${successCount} item${successCount === 1 ? "" : "s"} ✓`);
    } else if (successCount === 0) {
      toast.error(`Delete failed for all ${failures.length} item${failures.length === 1 ? "" : "s"} — ${failures[0].message}`);
    } else {
      toast.warning(
        `Deleted ${successCount} of ${ids.length} items — ${failures.length} failed (${failures.map((f) => f.itemName).join(", ")}).`,
      );
    }
    setSelectedIds(new Set());
    setConfirmingBulkDelete(false);
    setBulkDeleting(false);
  };

  const handleReset = () => {
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setAlternateUoms([]);
    setShowAlternateUoms(false);
    setErrors({});
  };

  const handleItemPrint = (item: Item) => {
    const group = itemGroups.find((g) => g.id === item.belongsTo);
    const uomRaw = Array.isArray(dbUoms)
      ? (dbUoms as any[]).find((u: any) => u.UOMCode === item.uomCode)
      : null;
    const uomLabel = uomRaw
      ? uomRaw.Symbol
        ? `${uomRaw.UOMName} (${uomRaw.Symbol})`
        : uomRaw.UOMName
      : item.uomCode;
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(safeHtml`
      <html><head><title>Item — ${item.itemName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Item Specification Sheet</h2>
      <table>
        <tr><td>Item Name</td><td>${item.itemName || "—"}</td></tr>
        <tr><td>Short Code</td><td>${item.shortCode || "—"}</td></tr>
        <tr><td>Description</td><td>${item.description || "—"}</td></tr>
        <tr><td>Type</td><td>${item.itemType || "—"}</td></tr>
        <tr><td>Item Group</td><td>${group?.description || "—"}</td></tr>
        <tr><td>HSN Code</td><td>${item.hsnCode || "—"}</td></tr>
        <tr><td>CGST / SGST / IGST</td><td>${item.cgst}% / ${item.sgst}% / ${item.igst}%</td></tr>
        <tr><td>UOM</td><td>${uomLabel || "—"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  // ── CSV template download ───────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], ITEM_CSV_TEMPLATE_COLUMNS, "item-master-template");
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
        const itemNameForLog = raw[CSV_HEADERS.itemName] || "(blank)";

        try {
          const itemName = (raw[CSV_HEADERS.itemName] || "").trim();
          const shortCode = (raw[CSV_HEADERS.shortCode] || "").trim();
          const itemTypeRaw = (raw[CSV_HEADERS.itemType] || "").trim();
          const itemGroupRaw = (raw[CSV_HEADERS.itemGroup] || "").trim();
          const uomRaw = (raw[CSV_HEADERS.uomCode] || "").trim();
          const hsnRaw = (raw[CSV_HEADERS.hsnCode] || "").trim();
          const supplierRaw = (raw[CSV_HEADERS.defaultSupplier] || "").trim();
          const glLedgerRaw = (raw[CSV_HEADERS.glLedger] || "").trim();
          const costCentreRaw = (raw[CSV_HEADERS.costCentre] || "").trim();
          const description = (raw[CSV_HEADERS.description] || "").trim();

          if (!itemName) throw new Error("Item Name is required");
          if (!shortCode) throw new Error("Short Code is required");

          const itemType =
            itemTypeRaw.toLowerCase() === "service"
              ? "Service"
              : itemTypeRaw.toLowerCase() === "goods"
                ? "Goods"
                : itemTypeRaw.toLowerCase() === "fixed asset"
                  ? "Fixed Asset"
                  : "";
          if (!itemType)
            throw new Error(
              `Item Type must be "Goods", "Service", or "Fixed Asset" (got "${itemTypeRaw}")`,
            );

          if (!itemGroupRaw) throw new Error("Item Group is required");
          const group = itemGroups.find(
            (g) => g.description.toLowerCase() === itemGroupRaw.toLowerCase(),
          );
          if (!group)
            throw new Error(`Item Group "${itemGroupRaw}" was not found`);

          // UOM is optional — resolve if provided, ignore silently if blank.
          let uomCode = "";
          if (uomRaw) {
            const matchedUom = uomOptions.find(
              (u) =>
                u.value.toLowerCase() === uomRaw.toLowerCase() ||
                u.label.toLowerCase().startsWith(uomRaw.toLowerCase()),
            );
            if (!matchedUom) throw new Error(`UOM "${uomRaw}" was not found`);
            uomCode = matchedUom.value;
          }

          // Default supplier is optional — same resolve-if-present pattern.
          let defaultSupplierId = "";
          if (supplierRaw) {
            const matchedSupplier = supplierOptions.find(
              (s) => s.label.toLowerCase() === supplierRaw.toLowerCase(),
            );
            if (!matchedSupplier)
              throw new Error(
                `Default Supplier "${supplierRaw}" was not found`,
              );
            defaultSupplierId = matchedSupplier.value;
          }

          // GL Account tag is optional — match by label or code.
          let glHeadId = "";
          if (glLedgerRaw) {
            const matchedGl = (Array.isArray(dbGlAccounts) ? dbGlAccounts : []).find(
              (g: any) =>
                (g.label ?? "").toLowerCase() === glLedgerRaw.toLowerCase() ||
                (g.code ?? "").toLowerCase() === glLedgerRaw.toLowerCase(),
            );
            if (!matchedGl)
              throw new Error(`GL Account "${glLedgerRaw}" was not found`);
            glHeadId = String(matchedGl.id);
          }

          // Cost Centre tag is optional — same resolve-if-present pattern.
          let costCenterId = "";
          if (costCentreRaw) {
            const matchedCc = costCenterOptions.find(
              (c) => c.label.toLowerCase() === costCentreRaw.toLowerCase(),
            );
            if (!matchedCc)
              throw new Error(`Cost Centre "${costCentreRaw}" was not found`);
            costCenterId = matchedCc.value;
          }

          // HSN — required, and is now the sole source of GST rates.
          // No CGST/SGST/IGST columns in the CSV; rates are always looked
          // up from the HSN code, same as picking an HSN in the form.
          let hsnCode = "";
          let cgst = 0;
          let sgst = 0;
          let igst = 0;
          if (hsnRaw) {
            const matchedHsn = codesFor(itemType).find((h) => h.code === hsnRaw);
            if (!matchedHsn)
              throw new Error(
                `${itemType === "Service" ? "SAC" : "HSN"} Code "${hsnRaw}" was not found`,
              );
            hsnCode = matchedHsn.code;
            cgst = matchedHsn.cgstRate ?? 0;
            sgst = matchedHsn.sgstRate ?? 0;
            igst = matchedHsn.igstRate ?? 0;
          }

          const payload = itemToPayload(
            {
              itemName,
              description,
              shortCode,
              itemType,
              hsnCode,
              cgst,
              sgst,
              igst,
              belongsTo: group.id,
              uomCode,
              defaultSupplierId,
              glHeadId,
              costCenterId,
              // No Days of Supply column in the CSV format — same
              // empty-default this field already gets on the manual Add
              // form (EMPTY_FORM below).
              daysOfSupply: "",
            },
            group.description,
          );

          await addItem(payload);
          results.push({ row: rowNum, itemName, status: "success" });
        } catch (err: any) {
          results.push({
            row: rowNum,
            itemName: itemNameForLog,
            status: "error",
            message: err?.message || "Unknown error",
          });
        }
      }

      setImportResults(results);
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.length - successCount;

      if (successCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ["item-master"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} item${successCount === 1 ? "" : "s"} ✓`,
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

  const filtered = data.filter(
    (r) =>
      !search ||
      Object.values(r).some((v) =>
        String(v).toLowerCase().includes(search.toLowerCase()),
      ),
  );

  // ── Column Definitions ────────────────────────────────────────────────────
  // Defined inside the component so handlers and itemGroups are in scope
  const ITEM_COLUMNS: ColumnDef<Item>[] = [
    ...(rights.canDelete
      ? [
          {
            id: "select",
            header: () => {
              const allSelected =
                filtered.length > 0 && filtered.every((r) => selectedIds.has(r._id));
              return (
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => {
                    setSelectedIds(
                      checked ? new Set(filtered.map((r) => r._id)) : new Set(),
                    );
                  }}
                  aria-label="Select all"
                  onClick={(e) => e.stopPropagation()}
                />
              );
            },
            size: 36,
            cell: ({ row }: { row: { original: Item } }) => (
              <Checkbox
                checked={selectedIds.has(row.original._id)}
                onCheckedChange={() => toggleSelected(row.original._id)}
                aria-label={`Select ${row.original.itemName}`}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          } as ColumnDef<Item>,
        ]
      : []),
    {
      accessorKey: "shortCode",
      header: "Short Code",
      size: 100,
      cell: ({ row }) => (
        <span className="font-heading font-medium text-primary">
          {row.original.shortCode}
        </span>
      ),
    },
    {
      accessorKey: "itemName",
      header: "Item Name",
      size: 170,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.itemName}</span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      size: 240,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.description || "-"}
        </span>
      ),
    },
    {
      accessorKey: "itemType",
      header: "Type",
      size: 110,
      cell: ({ row }) => {
        const type = row.original.itemType;
        if (!type) return <span className="text-muted-foreground">-</span>;
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${
              type === "Service"
                ? "bg-card text-foreground"
                : type === "Fixed Asset"
                  ? "bg-card text-foreground"
                  : "bg-card text-foreground"
            }`}
          >
            {type}
          </span>
        );
      },
    },
    {
      accessorKey: "belongsTo",
      header: "Group",
      size: 150,
      cell: ({ row }) => {
        const group = itemGroups.find((g) => g.id === row.original.belongsTo);
        return (
          <span className="text-sm">
            {group?.description || row.original.belongsTo || "-"}
          </span>
        );
      },
    },
    {
      accessorKey: "uomCode",
      header: "UOM",
      size: 130,
      cell: ({ row }) => {
        const uomRaw = Array.isArray(dbUoms)
          ? (dbUoms as any[]).find(
              (u: any) => u.UOMCode === row.original.uomCode,
            )
          : null;
        const uomLabel = uomRaw
          ? uomRaw.Symbol
            ? `${uomRaw.UOMName} (${uomRaw.Symbol})`
            : uomRaw.UOMName
          : row.original.uomCode;
        return <span className="text-sm">{uomLabel || "-"}</span>;
      },
    },
    {
      accessorKey: "defaultSupplierId",
      header: "Default Supplier",
      size: 160,
      cell: ({ row }) => {
        const sup = supplierOptions.find(
          (s) => s.value === row.original.defaultSupplierId,
        );
        return (
          <span className="text-sm text-muted-foreground">
            {sup?.label || "-"}
          </span>
        );
      },
    },
    {
      accessorKey: "glHeadId",
      header: "GL Account",
      size: 150,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {dbItems?.find((i) => i.M_Id === row.original._id)?.GLHeadName || "-"}
        </span>
      ),
    },
    {
      accessorKey: "costCenterId",
      header: "Cost Centre",
      size: 150,
      cell: ({ row }) => {
        const cc = costCenterOptions.find(
          (c) => c.value === row.original.costCenterId,
        );
        return (
          <span className="text-sm text-muted-foreground">{cc?.label || "-"}</span>
        );
      },
    },
    {
      accessorKey: "daysOfSupply",
      header: "Days of Supply",
      size: 130,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.daysOfSupply || "-"}
        </span>
      ),
    },
    {
      accessorKey: "hsnCode",
      header: "HSN",
      size: 90,
      cell: ({ row }) => (
        <span className="font-heading text-sm">{row.original.hsnCode || "-"}</span>
      ),
    },
    {
      id: "tax",
      header: "CGST / SGST / IGST",
      size: 160,
      cell: ({ row }) => {
        const { cgst, sgst, igst } = row.original;
        const hasRate = cgst > 0 || sgst > 0 || igst > 0;
        return (
          <span
            className={`text-sm font-heading ${hasRate ? "" : "text-muted-foreground"}`}
          >
            {hasRate ? `${cgst}% / ${sgst}% / ${igst}%` : "-"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      size: 140,
      cell: ({ row }) => {
        const id = row.original._id;
        const isConfirming = deleteConfirmId === id;

        return (
          <div className="flex items-center gap-1">
            {isConfirming ? (
              // Inline delete confirmation
              <>
                <span className="text-xs text-destructive mr-1">Delete?</span>
                <button
                  title="Confirm delete"
                  onClick={() => handleDelete(id)}
                  className="p-1 hover:bg-destructive/10 text-destructive transition-colors"
                >
                  <Check size={15} />
                </button>
                <button
                  title="Cancel"
                  onClick={() => setDeleteConfirmId(null)}
                  className="p-1 hover:bg-primary/5 text-muted-foreground transition-colors"
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <button data-row-view
                  title="View details"
                  onClick={() => setViewRow(row.original)}
                  className="p-1 hover:bg-primary/5 text-foreground transition-colors"
                >
                  <Eye size={15} />
                </button>
                {rights.canPrint && (
                  <button
                    title="Print"
                    onClick={() => handleItemPrint(row.original)}
                    className="p-1 hover:bg-primary/5 text-foreground transition-colors"
                  >
                    <Printer size={15} />
                  </button>
                )}
                {rights.canEdit && (
                  <button
                    title="Edit"
                    onClick={() => handleEdit(id)}
                    className="p-1 hover:bg-primary/10 text-primary transition-colors"
                  >
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button
                    title="Delete"
                    onClick={() => setDeleteConfirmId(id)}
                    className="p-1 hover:bg-destructive/10 text-destructive transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];


  return {
    queryClient,
    rights,
    dbGroups,
    dbUoms,
    dbHsn,
    itemGroups,
    uomOptions,
    toHsnCode,
    activeHsnRows,
    hsnCodes,
    sacCodes,
    codesFor,
    dbSuppliers,
    supplierOptions,
    dbCostCenters,
    costCenterOptions,
    dbGlAccounts,
    data,
    form,
    setFormState,
    editingId,
    setEditingId,
    errors,
    setErrors,
    search,
    setSearch,
    deleteConfirmId,
    setDeleteConfirmId,
    saving,
    setSaving,
    viewRow,
    setViewRow,
    selectedIds,
    setSelectedIds,
    confirmingBulkDelete,
    setConfirmingBulkDelete,
    bulkDeleting,
    setBulkDeleting,
    alternateUoms,
    setAlternateUoms,
    showAlternateUoms,
    setShowAlternateUoms,
    loadingAlternateUoms,
    setLoadingAlternateUoms,
    importFileInputRef,
    importing,
    setImporting,
    importResults,
    setImportResults,
    set,
    validate,
    validateAlternateUoms,
    handleSave,
    handleEdit,
    handleRenameDuplicate,
    handleDelete,
    toggleSelected,
    handleSearchChange,
    handleBulkDelete,
    handleReset,
    handleItemPrint,
    handleDownloadTemplate,
    handleImportClick,
    handleImportFileChange,
    filtered,
    ITEM_COLUMNS,
    dbItems,
    isLoading,
    error,
  };
}

export type ItemMasterState = ReturnType<typeof useItemMaster>;
