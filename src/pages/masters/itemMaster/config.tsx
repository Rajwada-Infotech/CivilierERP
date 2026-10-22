// Types, row <-> form conversions, CSV columns, the HSN dropdown and the field wrapper shared by the Item Master page and its parts.
import React, { useState, useRef, useEffect } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { type DbItem } from "@/api/itemMasterApi";
import { type ExportColumn } from "@/lib/export";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface HsnCode {
  code: string;
  description: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}
export interface Item {
  _id: string;
  itemName: string;
  description: string;
  shortCode: string;
  itemType: "Service" | "Goods" | "Fixed Asset" | "";
  hsnCode: string;
  cgst: number;
  sgst: number;
  igst: number;
  belongsTo: string;
  uomCode: string;
  defaultSupplierId: string;
  glHeadId: string;
  costCenterId: string;
  daysOfSupply: string;
}

export function dbToItem(row: DbItem): Item {
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
    daysOfSupply:
      row.M_DaysOfSupply != null ? String(row.M_DaysOfSupply) : "",
  };
}

export function itemToPayload(form: Omit<Item, "_id">, groupName: string) {
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
    M_DaysOfSupply: form.daysOfSupply ? parseInt(form.daysOfSupply) : null,
  };
}

export const EMPTY_FORM: Omit<Item, "_id"> = {
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
  daysOfSupply: "",
};

// ── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
export const CSV_HEADERS = {
  itemName: "Item Name",
  shortCode: "Short Code",
  itemType: "Item Type (Goods/Service)",
  itemGroup: "Item Group",
  uomCode: "UOM",
  hsnCode: "HSN Code",
  defaultSupplier: "Default Supplier",
  glLedger: "GL Account",
  costCentre: "Cost Centre",
  description: "Description",
} as const;

export const ITEM_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
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

export interface ImportRowResult {
  row: number;
  itemName: string;
  status: "success" | "error";
  message?: string;
}

// ── Searchable HSN Dropdown ───────────────────────────────────────────────────
export const HsnDropdown: React.FC<{
  value: string;
  onChange: (code: string) => void;
  hsnCodes: HsnCode[];
  /** "HSN" for goods, "SAC" for services — only changes the wording. */
  label?: string;
}> = ({ value, onChange, hsnCodes, label = "HSN" }) => {
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
          <span className="text-muted-foreground">Select {label} code...</span>
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
                No {label} codes available
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No {label} codes found
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
export const Field = ({
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

export const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
    err ? "border-destructive" : "border-border"
  }`;
