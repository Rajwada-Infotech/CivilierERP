import React from "react";
import { useState, useCallback, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  FileEdit,
  Eye,
  Save,
  X,
  AlertTriangle,
  Clock,
  User,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  FileText,
  Package,
  ShoppingCart,
  Briefcase,
  Receipt,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocType = "GRN" | "PO" | "WO" | "EB";

interface AuditEntry {
  field: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  changedAt: string;
  reason: string;
}

interface AmendedField {
  field: string;
  label: string;
  oldValue: string | number;
  newValue: string | number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DOC_TYPE_CONFIG: Record<
  DocType,
  {
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    api: string;
    idField: string;
    refField: string;
    color: string;
    searchPlaceholder: string;
  }
> = {
  GRN: {
    label: "Goods Receipt Note",
    icon: Package,
    api: "/api/grns",
    idField: "GRNID",
    refField: "GRNNo",
    color: "text-emerald-500",
    searchPlaceholder: "Search by GRN No, supplier...",
  },
  PO: {
    label: "Purchase Order",
    icon: ShoppingCart,
    api: "/api/purchase-orders",
    idField: "PurchaseOrderID",
    refField: "PurchaseOrderNo",
    color: "text-blue-500",
    searchPlaceholder: "Search by PO No, supplier...",
  },
  WO: {
    label: "Work Order",
    icon: Briefcase,
    api: "/api/work-orders",
    idField: "Id",
    refField: "DocumentNumber",
    color: "text-amber-500",
    searchPlaceholder: "Search by WO No, contractor...",
  },
  EB: {
    label: "Expense Booking",
    icon: Receipt,
    api: "/api/expense-booking",
    idField: "Eid",
    refField: "EDocNo",
    color: "text-purple-500",
    searchPlaceholder: "Search by voucher no, supplier...",
  },
};

const EDITABLE_FIELDS: Record<
  DocType,
  {
    key: string;
    label: string;
    type: "text" | "number" | "date";
    locked?: boolean;
  }[]
> = {
  GRN: [
    { key: "GRNNo", label: "GRN Number", type: "text", locked: true },
    { key: "GRNDate", label: "GRN Date", type: "date" },
    { key: "Status", label: "Status", type: "text" },
    { key: "Remarks", label: "Remarks", type: "text" },
    { key: "SupplierName", label: "Supplier", type: "text", locked: true },
  ],
  PO: [
    { key: "PurchaseOrderNo", label: "PO Number", type: "text", locked: true },
    { key: "PODate", label: "PO Date", type: "date" },
    { key: "ExpectedDeliveryDate", label: "Expected Delivery", type: "date" },
    { key: "ItemDescription", label: "Item Description", type: "text" },
    { key: "Quantity", label: "Quantity", type: "number" },
    { key: "Rate", label: "Rate", type: "number" },
    { key: "TotalAmount", label: "Total Amount", type: "number", locked: true },
    { key: "PaymentTerms", label: "Payment Terms", type: "text" },
    { key: "Status", label: "Status", type: "text" },
    { key: "Remarks", label: "Remarks", type: "text" },
  ],
  WO: [
    { key: "DocumentNumber", label: "WO Number", type: "text", locked: true },
    { key: "DocumentDate", label: "WO Date", type: "date" },
    { key: "TotalAmount", label: "Total Amount", type: "number", locked: true },
    { key: "Status", label: "Status", type: "text" },
    { key: "ContractorName", label: "Contractor", type: "text", locked: true },
  ],
  EB: [
    { key: "EDocNo", label: "Voucher No", type: "text", locked: true },
    { key: "EDocDate", label: "Booking Date", type: "date" },
    { key: "EReminder", label: "Due Date", type: "date" },
    { key: "EProjectName", label: "Supplier / Vendor", type: "text" },
    { key: "EDocumentType", label: "Material Category", type: "text" },
    { key: "EAmount", label: "Basic Amount", type: "number" },
    { key: "ECgstRate", label: "CGST %", type: "number" },
    { key: "ESgstRate", label: "SGST %", type: "number" },
    { key: "ENetAmount", label: "Net Amount", type: "number", locked: true },
    { key: "EStatus", label: "Status", type: "text" },
    { key: "ERemarks", label: "Remarks", type: "text" },
  ],
};

const AMENDMENT_REASONS = [
  "Data Entry Error",
  "Vendor/Supplier Correction",
  "Quantity Revision",
  "Rate Revision",
  "Date Correction",
  "Tax Rate Correction",
  "Description Update",
  "Status Correction",
  "Management Instruction",
  "Other",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "string" && val.length > 10 && val.includes("T")) {
    try {
      return val.slice(0, 10);
    } catch {
      /* fall */
    }
  }
  return String(val);
}

function getSearchableText(
  row: Record<string, unknown>,
  docType: DocType,
): string {
  const cfg = DOC_TYPE_CONFIG[docType];
  return [
    row[cfg.refField],
    row.SupplierName,
    row.LHeadName,
    row.ContractorName,
    row.EProjectName,
    row.ItemDescription,
    row.DocumentNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Amendments() {
  const [docType, setDocType] = useState<DocType>("GRN");
  const [searchQuery, setSearchQuery] = useState("");
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedValues, setEditedValues] = useState<
    Record<string, string | number>
  >({});
  const [amendReason, setAmendReason] = useState("");
  const [amendReasonOther, setAmendReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [amendedFields, setAmendedFields] = useState<AmendedField[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  const cfg = DOC_TYPE_CONFIG[docType];
  const fields = EDITABLE_FIELDS[docType];

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setSelectedRecord(null);
    setEditMode(false);
    setAmendedFields([]);
    setShowComparison(false);
    try {
      const res = await fetchWithAuth(`${cfg.api}?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const arr: Record<string, unknown>[] = Array.isArray(json)
        ? json
        : Array.isArray((json as { data?: unknown }).data)
          ? (json as { data: Record<string, unknown>[] }).data
          : Array.isArray((json as { recordset?: unknown }).recordset)
            ? (json as { recordset: Record<string, unknown>[] }).recordset
            : [];
      setRecords(arr);
    } catch (err: unknown) {
      toast.error(
        "Failed to fetch: " +
          (err instanceof Error ? err.message : String(err)),
      );
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [cfg.api]);

  React.useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) => getSearchableText(r, docType).includes(q));
  }, [records, searchQuery, docType]);

  const selectRecord = (rec: Record<string, unknown>) => {
    setSelectedRecord(rec);
    setEditMode(false);
    setEditedValues({});
    setAmendReason("");
    setAmendReasonOther("");
    setAmendedFields([]);
    setShowComparison(false);
    const key = `amendment_audit_${docType}_${rec[cfg.idField]}`;
    try {
      const stored = localStorage.getItem(key);
      setAuditLog(stored ? (JSON.parse(stored) as AuditEntry[]) : []);
    } catch {
      setAuditLog([]);
    }
  };

  const enterEdit = () => {
    if (!selectedRecord) return;
    const initial: Record<string, string | number> = {};
    fields.forEach((f) => {
      if (!f.locked) {
        const val = selectedRecord[f.key];
        initial[f.key] =
          typeof val === "number" ? val : fmt(val) === "—" ? "" : fmt(val);
      }
    });
    setEditedValues(initial);
    setEditMode(true);
    setShowComparison(false);
    setShowAudit(false);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditedValues({});
    setAmendReason("");
    setAmendReasonOther("");
    setAmendedFields([]);
  };

  const computeDiff = (): AmendedField[] => {
    if (!selectedRecord) return [];
    return fields
      .filter((f) => !f.locked && editedValues[f.key] !== undefined)
      .filter((f) => {
        const orig =
          fmt(selectedRecord[f.key]) === "—" ? "" : fmt(selectedRecord[f.key]);
        return orig !== String(editedValues[f.key] ?? "");
      })
      .map((f) => ({
        field: f.key,
        label: f.label,
        oldValue: fmt(selectedRecord[f.key]),
        newValue: String(editedValues[f.key] ?? ""),
      }));
  };

  const previewChanges = () => {
    const diff = computeDiff();
    if (diff.length === 0) {
      toast.info("No changes detected.");
      return;
    }
    setAmendedFields(diff);
    setShowComparison(true);
  };

  const saveAmendment = async () => {
    if (!selectedRecord) return;
    const reason = amendReason === "Other" ? amendReasonOther : amendReason;
    if (!reason.trim()) {
      toast.error("Amendment reason is required.");
      return;
    }
    const diff = computeDiff();
    if (diff.length === 0) {
      toast.info("No changes to save.");
      return;
    }

    const payload: Record<string, unknown> = { ...selectedRecord };
    fields.forEach((f) => {
      if (!f.locked && editedValues[f.key] !== undefined) {
        payload[f.key] =
          f.type === "number"
            ? parseFloat(String(editedValues[f.key])) || 0
            : editedValues[f.key];
      }
    });

    setSaving(true);
    try {
      const id = selectedRecord[cfg.idField];
      const res = await fetchWithAuth(`${cfg.api}/${String(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const now = new Date().toISOString();
      const storedUser = (() => {
        try {
          return (
            (
              JSON.parse(localStorage.getItem("user") ?? "{}") as {
                name?: string;
              }
            ).name ?? "Unknown"
          );
        } catch {
          return "Unknown";
        }
      })();
      const newEntries: AuditEntry[] = diff.map((d) => ({
        field: d.label,
        oldValue: String(d.oldValue),
        newValue: String(d.newValue),
        changedBy: storedUser,
        changedAt: now,
        reason,
      }));

      const key = `amendment_audit_${docType}_${String(id)}`;
      const existing = (() => {
        try {
          return JSON.parse(localStorage.getItem(key) ?? "[]") as AuditEntry[];
        } catch {
          return [] as AuditEntry[];
        }
      })();
      const merged = [...existing, ...newEntries];
      localStorage.setItem(key, JSON.stringify(merged));
      setAuditLog(merged);

      const updatedRec = { ...selectedRecord, ...payload };
      setSelectedRecord(updatedRec);
      setRecords((prev) =>
        prev.map((r) => (r[cfg.idField] === id ? updatedRec : r)),
      );
      setAmendedFields(diff);
      setShowComparison(true);
      setEditMode(false);
      setEditedValues({});
      setAmendReason("");
      setAmendReasonOther("");
      toast.success(`Amendment saved — ${diff.length} field(s) updated.`);
    } catch (err: unknown) {
      toast.error(
        "Save failed: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Amendments"]} />
      <div className="space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-lg sm:text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <FileEdit size={20} className="text-primary" />
            Amendments
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Centralized amendment workflow for GRN, PO, WO &amp; Expense Booking
            — with full audit trail.
          </p>
        </div>

        {/* Doc Type Tabs */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DOC_TYPE_CONFIG) as DocType[]).map((dt) => {
            const c = DOC_TYPE_CONFIG[dt];
            const Icon = c.icon;
            const active = docType === dt;
            return (
              <button
                key={dt}
                type="button"
                onClick={() => {
                  setDocType(dt);
                  setSelectedRecord(null);
                  setEditMode(false);
                  setSearchQuery("");
                  setAmendedFields([]);
                  setShowComparison(false);
                  setShowAudit(false);
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <Icon size={14} />
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left: Search + List */}
          <div className="lg:col-span-2 space-y-3">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3 px-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Search
                    size={14}
                    className="text-muted-foreground shrink-0"
                  />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={cfg.searchPlaceholder}
                    className="h-8 text-xs border-0 shadow-none focus-visible:ring-0 p-0 bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={fetchRecords}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Refresh"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading && (
                  <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Loading…
                  </div>
                )}
                {!loading && filteredRecords.length === 0 && (
                  <div className="py-10 text-center text-muted-foreground text-sm">
                    No records found.
                  </div>
                )}
                <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
                  {filteredRecords.map((rec, i) => {
                    const id = rec[cfg.idField];
                    const ref = fmt(rec[cfg.refField]);
                    const isSelected =
                      selectedRecord && selectedRecord[cfg.idField] === id;
                    const supplierName = fmt(
                      rec.SupplierName ??
                        rec.LHeadName ??
                        rec.ContractorName ??
                        rec.EProjectName ??
                        null,
                    );
                    const status = fmt(rec.Status ?? rec.EStatus ?? null);
                    const hasAudit = (() => {
                      try {
                        const k = `amendment_audit_${docType}_${String(id)}`;
                        const s = localStorage.getItem(k);
                        return s
                          ? (JSON.parse(s) as unknown[]).length > 0
                          : false;
                      } catch {
                        return false;
                      }
                    })();
                    return (
                      <button
                        key={String(id ?? i)}
                        type="button"
                        onClick={() => selectRecord(rec)}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          isSelected
                            ? "bg-primary/8 border-l-2 border-l-primary"
                            : "hover:bg-muted/40 border-l-2 border-l-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-xs font-semibold ${cfg.color}`}
                          >
                            {ref || `#${String(id)}`}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {hasAudit && (
                              <span
                                title="Has amendment history"
                                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                              />
                            )}
                            {status !== "—" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                                {status}
                              </span>
                            )}
                          </div>
                        </div>
                        {supplierName !== "—" && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {supplierName}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!loading && (
                  <div className="px-4 py-2 border-t border-border bg-muted/20">
                    <span className="text-[11px] text-muted-foreground">
                      {filteredRecords.length} of {records.length} records
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Detail / Edit */}
          <div className="lg:col-span-3 space-y-4">
            {!selectedRecord ? (
              <Card className="border-dashed border-border">
                <CardContent className="flex flex-col items-center justify-center py-20 text-center gap-3">
                  <FileText size={36} className="text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Select a {cfg.label} from the list to view its details and
                    submit amendments.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Record card */}
                <Card className="border-primary/20 shadow-sm">
                  <CardHeader className="pb-3 px-4 sm:px-5 border-b border-border">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-mono text-sm font-bold ${cfg.color}`}
                          >
                            {fmt(selectedRecord[cfg.refField])}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {cfg.label}
                          </Badge>
                          {(selectedRecord.Status ?? selectedRecord.EStatus) !=
                            null && (
                            <Badge variant="secondary" className="text-[10px]">
                              {fmt(
                                selectedRecord.Status ?? selectedRecord.EStatus,
                              )}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          ID: {fmt(selectedRecord[cfg.idField])}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!editMode ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs gap-1.5"
                              onClick={() => {
                                setShowAudit((p) => !p);
                                setShowComparison(false);
                              }}
                            >
                              <Clock size={12} />
                              History
                              {auditLog.length > 0 && (
                                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px] font-semibold">
                                  {auditLog.length}
                                </span>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1.5 gradient-accent"
                              onClick={enterEdit}
                            >
                              <FileEdit size={12} />
                              Amend
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs gap-1.5"
                              onClick={previewChanges}
                            >
                              <Eye size={12} />
                              Preview
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={cancelEdit}
                            >
                              <X size={12} />
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1.5 gradient-accent"
                              onClick={saveAmendment}
                              disabled={saving}
                            >
                              {saving ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Save size={12} />
                              )}
                              Save
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {editMode && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>
                          You are in amendment mode. Changes require a reason
                          and will be logged to the audit trail.
                        </span>
                      </div>
                    )}
                  </CardHeader>

                  <CardContent className="pt-4 px-4 sm:px-5 space-y-4">
                    {/* Fields grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {fields.map((f) => {
                        const origVal = fmt(selectedRecord[f.key]);
                        const isEditable = editMode && !f.locked;
                        const currentEdit = String(
                          editedValues[f.key] ??
                            (origVal === "—" ? "" : origVal),
                        );
                        const hasChange =
                          isEditable &&
                          currentEdit !== (origVal === "—" ? "" : origVal);

                        return (
                          <div key={f.key} className="space-y-1">
                            <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                              {f.label}
                              {f.locked && editMode && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-muted border border-border text-muted-foreground/70">
                                  locked
                                </span>
                              )}
                            </label>
                            {isEditable ? (
                              <div className="relative">
                                <input
                                  type={
                                    f.type === "date"
                                      ? "date"
                                      : f.type === "number"
                                        ? "number"
                                        : "text"
                                  }
                                  value={currentEdit}
                                  onChange={(e) =>
                                    setEditedValues((prev) => ({
                                      ...prev,
                                      [f.key]:
                                        f.type === "number"
                                          ? parseFloat(e.target.value) || 0
                                          : e.target.value,
                                    }))
                                  }
                                  className={`w-full px-3 py-1.5 rounded-lg text-sm border bg-background focus:outline-none focus:ring-2 focus:ring-primary transition-all ${
                                    hasChange
                                      ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20 text-foreground"
                                      : "border-border text-foreground"
                                  }`}
                                />
                                {hasChange && (
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                    ✎
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div
                                className={`px-3 py-1.5 rounded-lg text-sm border border-border ${
                                  f.locked && editMode
                                    ? "bg-muted/50 text-muted-foreground"
                                    : "bg-muted/20 text-foreground"
                                }`}
                              >
                                {origVal}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Reason section */}
                    {editMode && (
                      <div className="pt-3 border-t border-border space-y-3">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <AlertTriangle size={12} className="text-amber-500" />
                          Amendment Reason{" "}
                          <span className="text-destructive">*</span>
                        </label>
                        <Select
                          value={amendReason}
                          onValueChange={setAmendReason}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="Select reason for amendment..." />
                          </SelectTrigger>
                          <SelectContent>
                            {AMENDMENT_REASONS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {amendReason === "Other" && (
                          <textarea
                            value={amendReasonOther}
                            onChange={(e) =>
                              setAmendReasonOther(e.target.value)
                            }
                            placeholder="Describe the reason for this amendment..."
                            rows={2}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                          />
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Side-by-side comparison */}
                {showComparison && amendedFields.length > 0 && (
                  <Card className="border-amber-400/40 shadow-sm">
                    <CardHeader className="pb-0 px-4 sm:px-5">
                      <button
                        type="button"
                        className="flex items-center justify-between w-full py-3"
                        onClick={() => setShowComparison((p) => !p)}
                      >
                        <div className="flex items-center gap-2">
                          <ArrowLeftRight
                            size={14}
                            className="text-amber-500"
                          />
                          <CardTitle className="text-sm font-heading">
                            Change Summary —{" "}
                            <span className="text-amber-600 dark:text-amber-400">
                              {amendedFields.length} field
                              {amendedFields.length !== 1 ? "s" : ""} amended
                            </span>
                          </CardTitle>
                        </div>
                        {showComparison ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                    </CardHeader>
                    <CardContent className="px-4 sm:px-5 pb-4">
                      <div className="rounded-xl overflow-hidden border border-border">
                        <div className="grid grid-cols-3 bg-muted/60 px-4 py-2">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Field
                          </span>
                          <span className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">
                            Original
                          </span>
                          <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wide">
                            Amended
                          </span>
                        </div>
                        {amendedFields.map((af, idx) => (
                          <div
                            key={af.field}
                            className={`grid grid-cols-3 px-4 py-2.5 gap-2 items-center ${
                              idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                            }`}
                          >
                            <span className="text-xs font-medium text-foreground">
                              {af.label}
                            </span>
                            <span className="text-xs text-red-500 line-through font-mono break-all">
                              {af.oldValue || "—"}
                            </span>
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono font-semibold break-all">
                              {af.newValue}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Audit trail */}
                {showAudit && (
                  <Card className="border-border shadow-sm">
                    <CardHeader className="pb-0 px-4 sm:px-5">
                      <button
                        type="button"
                        className="flex items-center justify-between w-full py-3"
                        onClick={() => setShowAudit((p) => !p)}
                      >
                        <div className="flex items-center gap-2">
                          <Clock size={14} className="text-primary" />
                          <CardTitle className="text-sm font-heading">
                            Amendment History
                          </CardTitle>
                        </div>
                        {showAudit ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                    </CardHeader>
                    <CardContent className="px-4 sm:px-5 pb-4">
                      {auditLog.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                          No amendment history for this record.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {[...auditLog].reverse().map((entry, i) => (
                            <div
                              key={i}
                              className="rounded-xl border border-border p-3 space-y-2 bg-muted/10"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <User size={11} className="shrink-0" />
                                  <span className="font-medium text-foreground">
                                    {entry.changedBy}
                                  </span>
                                  <span>·</span>
                                  <Clock size={11} className="shrink-0" />
                                  <span>
                                    {new Date(entry.changedAt).toLocaleString(
                                      "en-IN",
                                    )}
                                  </span>
                                </div>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0">
                                  {entry.reason}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <span className="text-muted-foreground font-medium">
                                  {entry.field}
                                </span>
                                <span className="text-red-500 line-through font-mono break-all">
                                  {entry.oldValue || "—"}
                                </span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-mono font-semibold break-all">
                                  {entry.newValue}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
