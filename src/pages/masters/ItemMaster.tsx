import React, { useState, useCallback, useRef, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  ChevronDown,
  Eye,
  Printer,
  Package,
  Download,
  Upload,
  RotateCcw,
  Save,
  Plus,
  Ruler,
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getItems,
  addItem,
  updateItem,
  deleteItem,
  type DbItem,
} from "@/api/itemMasterApi";
import {
  getItemUomAlternates,
  saveItemUomAlternates,
} from "@/api/itemUomAlternatesApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { getItemGroups } from "@/api/itemGroupApi";
import { getUomList } from "@/api/uomApi";
import { getHsn } from "@/api/hsnApi";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlternateUomTagger,
  type AlternateUomRow,
} from "./ItemUomAlternatesEditor";
import { GLAccountSelect } from "@/components/finance/GLAccountSelect";

// ── Types ─────────────────────────────────────────────────────────────────────
interface HsnCode {
  code: string;
  description: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}
interface Item {
  _id: string;
  itemName: string;
  description: string;
  shortCode: string;
  itemType: "Service" | "Goods" | "";
  hsnCode: string;
  cgst: number;
  sgst: number;
  igst: number;
  belongsTo: string;
  uomCode: string;
  defaultSupplierId: string;
  glHeadId: string;
  costCenterId: string;
}

function dbToItem(row: DbItem): Item {
  return {
    _id: row.M_Id,
    itemName: row.M_Name || "",
    description: row.M_Description || "",
    shortCode: row.M_code || "",
    itemType: (row.M_Type as Item["itemType"]) || "",
    hsnCode: row.M_HSN || "",
    cgst: row.M_CGST ?? 0,
    sgst: row.M_SGST ?? 0,
    igst: row.M_IGST ?? 0,
    belongsTo: row.Parent_Id || "",
    uomCode: row.M_UOM || "",
    defaultSupplierId: row.default_supplier_id
      ? String(row.default_supplier_id)
      : "",
    glHeadId: row.M_GLHeadId ? String(row.M_GLHeadId) : "",
    costCenterId: row.M_CostCenterId ? String(row.M_CostCenterId) : "",
  };
}

function itemToPayload(form: Omit<Item, "_id">, groupName: string) {
  return {
    M_Name: form.itemName,
    M_Description: form.description || form.itemName,
    M_Type: form.itemType || null,
    M_code: form.shortCode || null,
    M_Group: groupName || null,
    M_BelongsTo: form.belongsTo || null,
    Parent_Id: form.belongsTo || null,
    M_HSN: form.hsnCode || null,
    M_IdentityCode: form.cgst > 0 || form.sgst > 0 || form.igst > 0 ? 1 : 0,
    M_CGST: form.cgst || null,
    M_SGST: form.sgst || null,
    M_IGST: form.igst || null,
    M_UOM: form.uomCode || null,
    default_supplier_id: form.defaultSupplierId
      ? parseInt(form.defaultSupplierId)
      : null,
    M_GLHeadId: form.glHeadId ? parseInt(form.glHeadId) : null,
    M_CostCenterId: form.costCenterId ? parseInt(form.costCenterId) : null,
  };
}

const EMPTY_FORM: Omit<Item, "_id"> = {
  itemName: "",
  description: "",
  shortCode: "",
  itemType: "",
  hsnCode: "",
  cgst: 0,
  sgst: 0,
  igst: 0,
  belongsTo: "",
  uomCode: "",
  defaultSupplierId: "",
  glHeadId: "",
  costCenterId: "",
};

// ── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  itemName: "Item Name",
  shortCode: "Short Code",
  itemType: "Item Type (Goods/Service)",
  itemGroup: "Item Group",
  uomCode: "UOM",
  hsnCode: "HSN Code",
  defaultSupplier: "Default Supplier",
  glLedger: "GL Ledger",
  costCentre: "Cost Centre",
  description: "Description",
} as const;

const ITEM_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: CSV_HEADERS.itemName, accessor: "itemName" },
  { header: CSV_HEADERS.shortCode, accessor: "shortCode" },
  { header: CSV_HEADERS.itemType, accessor: "itemType" },
  { header: CSV_HEADERS.itemGroup, accessor: "itemGroup" },
  { header: CSV_HEADERS.uomCode, accessor: "uomCode" },
  { header: CSV_HEADERS.hsnCode, accessor: "hsnCode" },
  { header: CSV_HEADERS.defaultSupplier, accessor: "defaultSupplier" },
  { header: CSV_HEADERS.glLedger, accessor: "glLedger" },
  { header: CSV_HEADERS.costCentre, accessor: "costCentre" },
  { header: CSV_HEADERS.description, accessor: "description" },
];

interface ImportRowResult {
  row: number;
  itemName: string;
  status: "success" | "error";
  message?: string;
}

// ── Searchable HSN Dropdown ───────────────────────────────────────────────────
const HsnDropdown: React.FC<{
  value: string;
  onChange: (code: string) => void;
  hsnCodes: HsnCode[];
}> = ({ value, onChange, hsnCodes }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = hsnCodes.find((h) => h.code === value);
  const filtered = query.trim()
    ? hsnCodes.filter(
        (h) =>
          h.code.includes(query) ||
          h.description.toLowerCase().includes(query.toLowerCase()),
      )
    : hsnCodes;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all"
      >
        {selected ? (
          <span className="flex items-center gap-2 truncate">
            <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {selected.code}
            </span>
            <span className="truncate text-muted-foreground">
              {selected.description}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Select HSN code...</span>
        )}
        <span className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }}
              className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background shadow-lg">
          <div className="p-2 relative">
            <Search
              size={13}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by code or description..."
              className="w-full pl-8 pr-3 py-1.5 rounded-md text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {hsnCodes.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No HSN codes available
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No HSN codes found
              </p>
            ) : (
              filtered.map((h) => (
                <button
                  key={h.code}
                  type="button"
                  onClick={() => {
                    onChange(h.code);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors ${
                    h.code === value ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                    {h.code}
                  </span>
                  <span className="text-sm text-muted-foreground truncate">
                    {h.description}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: boolean;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wide">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && (
      <span className="text-xs text-destructive">{label} is required</span>
    )}
  </div>
);

const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
    err ? "border-destructive" : "border-border"
  }`;

// ── Main Component ────────────────────────────────────────────────────────────
const ItemMaster: React.FC = () => {
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

  const hsnCodes: HsnCode[] = Array.isArray(dbHsn)
    ? dbHsn
        .filter((h: any) => h.HStatus !== false)
        .map((h: any) => ({
          code: h.HCode || "",
          description: h.HShortDescription || h.HDescription || "",
          cgstRate: h.HCGST ?? 0,
          sgstRate: h.HSGST ?? 0,
          igstRate: h.HIGST ?? 0,
        }))
    : [];

  // Fetch supplier list from AccountHeadMaster where LHeadType = 'S'
  const { data: dbSuppliers = [] } = useQuery({
    queryKey: ["suppliers-for-item-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/account-head/options?type=S");
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

  // GL Ledger master options — mirrors what GLAccountSelect fetches
  // internally, but this page also needs the raw list itself to resolve a
  // "GL Ledger" name/code typed in a CSV import row (GLAccountSelect only
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
          const hsn = hsnCodes.find((h) => h.code === val);
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
        return next;
      });
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors, hsnCodes],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.itemName.trim()) errs.itemName = true;
    if (!form.shortCode.trim()) errs.shortCode = true;
    if (!form.itemType) errs.itemType = true;
    if (!form.belongsTo) errs.belongsTo = true;
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
                : "";
          if (!itemType)
            throw new Error(
              `Item Type must be "Goods" or "Service" (got "${itemTypeRaw}")`,
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

          // GL Ledger tag is optional — match by label or code.
          let glHeadId = "";
          if (glLedgerRaw) {
            const matchedGl = (Array.isArray(dbGlAccounts) ? dbGlAccounts : []).find(
              (g: any) =>
                (g.label ?? "").toLowerCase() === glLedgerRaw.toLowerCase() ||
                (g.code ?? "").toLowerCase() === glLedgerRaw.toLowerCase(),
            );
            if (!matchedGl)
              throw new Error(`GL Ledger "${glLedgerRaw}" was not found`);
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
            const matchedHsn = hsnCodes.find((h) => h.code === hsnRaw);
            if (!matchedHsn)
              throw new Error(`HSN Code "${hsnRaw}" was not found`);
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
    {
      accessorKey: "shortCode",
      header: "Short Code",
      cell: ({ row }) => (
        <span className="font-mono font-medium text-primary">
          {row.original.shortCode}
        </span>
      ),
    },
    {
      accessorKey: "itemName",
      header: "Item Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.itemName}</span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.description || "-"}
        </span>
      ),
    },
    {
      accessorKey: "itemType",
      header: "Type",
      cell: ({ row }) => {
        const type = row.original.itemType;
        if (!type) return <span className="text-muted-foreground">-</span>;
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              type === "Service"
                ? "bg-blue-500/10 text-blue-600"
                : "bg-green-500/10 text-green-600"
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
      header: "GL Ledger",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {dbItems?.find((i) => i.M_Id === row.original._id)?.GLHeadName || "-"}
        </span>
      ),
    },
    {
      accessorKey: "costCenterId",
      header: "Cost Centre",
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
      accessorKey: "hsnCode",
      header: "HSN",
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.hsnCode || "-"}</span>
      ),
    },
    {
      id: "tax",
      header: "CGST / SGST / IGST",
      cell: ({ row }) => {
        const { cgst, sgst, igst } = row.original;
        const hasRate = cgst > 0 || sgst > 0 || igst > 0;
        return (
          <span
            className={`text-sm font-mono ${hasRate ? "" : "text-muted-foreground"}`}
          >
            {hasRate ? `${cgst}% / ${sgst}% / ${igst}%` : "-"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
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
                  className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                >
                  <Check size={15} />
                </button>
                <button
                  title="Cancel"
                  onClick={() => setDeleteConfirmId(null)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  title="View details"
                  onClick={() => setViewRow(row.original)}
                  className="p-1 rounded hover:bg-sky-500/10 text-sky-500 transition-colors"
                >
                  <Eye size={15} />
                </button>
                {rights.canPrint && (
                  <button
                    title="Print"
                    onClick={() => handleItemPrint(row.original)}
                    className="p-1 rounded hover:bg-amber-500/10 text-amber-500 transition-colors"
                  >
                    <Printer size={15} />
                  </button>
                )}
                {rights.canEdit && (
                  <button
                    title="Edit"
                    onClick={() => handleEdit(id)}
                    className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
                  >
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button
                    title="Delete"
                    onClick={() => setDeleteConfirmId(id)}
                    className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
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

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading)
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading items...
      </div>
    );
  if (error)
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-primary-foreground hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
        {/* ── Form ── */}
        {rights.canCreate && (
        <div className="rounded-xl border border-border bg-card p-6 mb-6">
          <h2 className="text-base font-heading font-semibold mb-4">
            {editingId ? "Edit Item" : "Add Item"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Item Name */}
            <Field label="Item Name" required error={errors.itemName}>
              <input
                type="text"
                value={form.itemName}
                onChange={(e) => set("itemName", e.target.value)}
                className={inputCls(errors.itemName)}
                placeholder="e.g. Cement UltraTech"
              />
            </Field>
            {/* Short Code */}
            <Field label="Short Code" required error={errors.shortCode}>
              <input
                type="text"
                value={form.shortCode}
                onChange={(e) => set("shortCode", e.target.value.toUpperCase())}
                className={inputCls(errors.shortCode)}
                placeholder="e.g. CEM"
                maxLength={6}
              />
            </Field>
            {/* Item Group */}
            <Field
              label="Item Group (Parent)"
              required
              error={errors.belongsTo}
            >
              <select
                value={form.belongsTo}
                onChange={(e) => set("belongsTo", e.target.value)}
                className={inputCls(errors.belongsTo)}
              >
                <option value="">Select group...</option>
                {itemGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.description}
                    {g.code ? ` (${g.code})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {/* UOM */}
            <Field label="Unit of Measure (UOM)">
              <div className="flex items-center gap-2">
                <select
                  value={form.uomCode}
                  onChange={(e) => set("uomCode", e.target.value)}
                  className={inputCls() + " flex-1"}
                >
                  <option value="">Select UOM...</option>
                  {uomOptions.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAlternateUoms((v) => !v)}
                  disabled={!form.uomCode}
                  title={
                    form.uomCode
                      ? "Tag alternate UOMs for this item"
                      : "Select this item's own UOM first"
                  }
                  className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    showAlternateUoms
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {alternateUoms.length > 0 && !showAlternateUoms ? (
                    <span className="text-[10px] font-bold">
                      {alternateUoms.length}
                    </span>
                  ) : (
                    <Plus size={14} />
                  )}
                </button>
              </div>
            </Field>

            {/* Alternate UOMs — inline, tagged before the item is even
                saved. Spans the full row so it isn't cramped next to the
                other 3-column fields. */}
            {showAlternateUoms && form.uomCode && (
              <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-xs font-heading font-semibold text-foreground flex items-center gap-1.5 mb-1">
                  <Ruler size={13} className="text-primary" />
                  Alternate UOMs
                </p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Tag other units this item can also be requested/ordered in,
                  with how many{" "}
                  <span className="font-mono">
                    {uomOptions.find((u) => u.value === form.uomCode)?.label ||
                      form.uomCode}
                  </span>{" "}
                  (this item's own UOM) one unit of the alternate equals —
                  e.g. Cement base Bag, tag CFT with factor 0.3 for 1 CFT =
                  0.3 Bag.
                </p>
                {loadingAlternateUoms ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 size={13} className="animate-spin" /> Loading…
                  </div>
                ) : (
                  <AlternateUomTagger
                    rows={alternateUoms}
                    onChange={setAlternateUoms}
                    baseUomCode={form.uomCode}
                    uomOptions={uomOptions}
                  />
                )}
              </div>
            )}
            {/* Type of Item */}
            <Field label="Type of Item" required error={errors.itemType}>
              <select
                value={form.itemType}
                onChange={(e) => set("itemType", e.target.value)}
                className={inputCls(errors.itemType)}
              >
                <option value="">Select type...</option>
                <option value="Service">Service</option>
                <option value="Goods">Goods</option>
              </select>
            </Field>
            {/* HSN Code */}
            <Field label="HSN Code">
              <HsnDropdown
                value={form.hsnCode}
                onChange={(val) => set("hsnCode", val)}
                hsnCodes={hsnCodes}
              />
            </Field>
            {/* Description */}
            <Field label="Description">
              <input
                type="text"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className={inputCls()}
                placeholder="Additional description (optional)"
              />
            </Field>
            {/* Default Supplier */}
            <Field label="Default Supplier">
              <select
                value={form.defaultSupplierId}
                onChange={(e) => set("defaultSupplierId", e.target.value)}
                className={inputCls()}
              >
                <option value="">— No default supplier —</option>
                {supplierOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            {/* GL Ledger tag — the account this item's spend is booked under */}
            <Field label="GL Ledger">
              <GLAccountSelect
                value={form.glHeadId ? parseInt(form.glHeadId, 10) : null}
                onChange={(id) => set("glHeadId", id ? String(id) : "")}
                placeholder="— No GL ledger tag —"
              />
            </Field>
            {/* Cost Centre tag — auto-fills the Cost Centre when this item is
                added to a Purchase Order (see PurchaseOrderMaster.tsx). */}
            <Field label="Cost Centre">
              <select
                value={form.costCenterId}
                onChange={(e) => set("costCenterId", e.target.value)}
                className={inputCls()}
              >
                <option value="">— No cost centre tag —</option>
                {costCenterOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* ── Tax Rates ── */}
          <div className="mt-4">
            <p className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Tax Rates{" "}
              {form.hsnCode && (
                <span className="normal-case text-primary font-normal">
                  (auto-filled from HSN)
                </span>
              )}
            </p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="CGST (%)">
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.cgst === 0 ? "" : form.cgst}
                    onChange={(e) =>
                      set("cgst", parseFloat(e.target.value) || 0)
                    }
                    placeholder="0"
                    className={inputCls() + " pr-8"}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    %
                  </span>
                </div>
              </Field>
              <Field label="SGST (%)">
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.sgst === 0 ? "" : form.sgst}
                    onChange={(e) =>
                      set("sgst", parseFloat(e.target.value) || 0)
                    }
                    placeholder="0"
                    className={inputCls() + " pr-8"}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    %
                  </span>
                </div>
              </Field>
              <Field label="IGST (%)">
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.igst === 0 ? "" : form.igst}
                    onChange={(e) =>
                      set("igst", parseFloat(e.target.value) || 0)
                    }
                    placeholder="0"
                    className={inputCls() + " pr-8"}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    %
                  </span>
                </div>
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden mt-2">
            <p className="hidden sm:block text-[11px] text-muted-foreground">
              Ready to save
            </p>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                onClick={handleReset}
                className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} /> Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {saving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : editingId ? (
                  <Check size={14} />
                ) : (
                  <Save size={14} />
                )}
                {saving ? "Saving…" : editingId ? "Update Item" : "Save Item"}
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ── Table ── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="relative mb-4">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <DataTable
            data={filtered}
            columns={ITEM_COLUMNS}
            loading={false}
            searchable={false}
            paginated={true}
            defaultPageSize={10}
            emptyMessage={
              search
                ? "No items match your search."
                : "No items yet. Add one above."
            }
            rowClassName={(row) =>
              row.original._id === deleteConfirmId ? "bg-destructive/5" : ""
            }
          />
        </div>

        {/* View Detail Modal */}
        <Dialog
          open={!!viewRow}
          onOpenChange={(open) => !open && setViewRow(null)}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                Item Details
              </DialogTitle>
            </DialogHeader>
            {viewRow &&
              (() => {
                const group = itemGroups.find(
                  (g) => g.id === viewRow.belongsTo,
                );
                const uomRaw = Array.isArray(dbUoms)
                  ? (dbUoms as any[]).find(
                      (u: any) => u.UOMCode === viewRow.uomCode,
                    )
                  : null;
                const uomLabel = uomRaw
                  ? uomRaw.Symbol
                    ? `${uomRaw.UOMName} (${uomRaw.Symbol})`
                    : uomRaw.UOMName
                  : viewRow.uomCode;
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
                    {[
                      { label: "Item Name", value: viewRow.itemName },
                      {
                        label: "Short Code",
                        value: viewRow.shortCode,
                        mono: true,
                      },
                      { label: "Type", value: viewRow.itemType },
                      { label: "Item Group", value: group?.description },
                      { label: "HSN Code", value: viewRow.hsnCode, mono: true },
                      { label: "CGST", value: `${viewRow.cgst}%` },
                      { label: "SGST", value: `${viewRow.sgst}%` },
                      { label: "IGST", value: `${viewRow.igst}%` },
                      { label: "UOM", value: uomLabel },
                      { label: "Description", value: viewRow.description },
                    ].map(({ label, value, mono }) => (
                      <div key={label}>
                        <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-0.5">
                          {label}
                        </p>
                        <p
                          className={`text-sm text-foreground break-words ${mono ? "font-mono" : "font-body"}`}
                        >
                          {value || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
              {viewRow && (
                <button
                  onClick={() => handleItemPrint(viewRow)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted transition-all"
                >
                  <Printer size={13} /> Print
                </button>
              )}
              <button
                onClick={() => setViewRow(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Import Results Modal */}
        <Dialog
          open={!!importResults}
          onOpenChange={(open) => !open && setImportResults(null)}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                Import Results
              </DialogTitle>
            </DialogHeader>
            {importResults && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-green-600">
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
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
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
                          className="text-green-600 shrink-0 mt-0.5"
                        />
                      ) : (
                        <X
                          size={14}
                          className="text-destructive shrink-0 mt-0.5"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          Row {r.row} — {r.itemName}
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
            <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
              <button
                onClick={() => setImportResults(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </MaterialShell>
    </>
  );
};

export default ItemMaster;
