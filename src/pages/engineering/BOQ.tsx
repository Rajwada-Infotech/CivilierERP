import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml, raw } from "@/utils/escapeHtml";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { type DbItem } from "@/api/itemMasterApi";
import { type DbActivity } from "@/api/activityMasterApi";
import { ApprovalActions } from "@/components/ApprovalActions";
import { AmendedBadge } from "@/components/AmendedBadge";
import { useAmendmentStatus } from "@/hooks/useAmendmentStatus";
import {
  FileText,
  Save,
  Search,
  Eye,
  Trash2,
  Plus,
  RefreshCw,
  X,
  Edit3,
  FilePenLine,
  Package,
  Settings2,
  Printer,
  ArrowLeft,
  Send,
  Calendar as CalendarIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { useFinYear } from "@/contexts/FinYearContext";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BoqItem {
  Id?: number;
  _key: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  description: string;
  quantity: string;
  uomName: string;
  rate: string;
  tax: string;
  amount: number;
}

interface BoqActivity {
  Id?: number;
  _key: string;
  activityId: string;
  activityName: string;
  activityCode: string;
  description: string;
  quantity: string;
  uomName: string;
  rate: string;
  tax: string;
  amount: number;
}

interface BoqRecord {
  BoqID: number;
  BoqNo: string;
  BoqDate: string;
  CompanyId: number | null;
  CompanyName?: string;
  ProjectId: number | null;
  ProjectName?: string;
  Description: string;
  TotalAmount: number;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
  Remarks: string;
  DocTypeId: number | null;
  DocNo: string;
  DocTypePrefix?: string;
  DocTypeDescription?: string;
  CreatedBy?: string;
  CreatedAt?: string;
  UpdatedBy?: string;
  UpdatedAt?: string;
  ApprovedBy?: string;
  RejectedBy?: string;
  RejectionNote?: string;
  BoqItems: BoqItem[];
  BoqActivities: BoqActivity[];
}

interface Company {
  id: number;
  label?: string;
  name?: string;
}
interface Project {
  id: number;
  label?: string;
  name?: string;
  companyId?: number | null;
}
interface DocType {
  id: number;
  code: string;
  name: string;
  description: string;
}
interface UomOption {
  Id: number;
  UOMName: string;
  UOMCode: string;
}
interface ItemOption {
  id: string;
  name: string;
  code: string;
  uomCode: string;
}
interface ActivityOption {
  id: string;
  name: string;
  code: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

let _uidSeed = 1;
const uid = () => `k${_uidSeed++}`;

const apiFetch = async (path: string, opts?: RequestInit) => {
  const url = `/api${path}`;
  const headers = new Headers(opts?.headers || {});
  if (!headers.has("Content-Type") && !(opts?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetchWithAuth(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n ?? 0);

const fmtDate = (d?: string) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const calcAmount = (qty: string, rate: string) =>
  (parseFloat(qty) || 0) * (parseFloat(rate) || 0);

const blankItem = (): BoqItem => ({
  _key: uid(),
  itemId: "",
  itemName: "",
  itemCode: "",
  description: "",
  quantity: "",
  uomName: "",
  rate: "",
  tax: "18",
  amount: 0,
});

const blankActivity = (): BoqActivity => ({
  _key: uid(),
  activityId: "",
  activityName: "",
  activityCode: "",
  description: "",
  quantity: "",
  uomName: "",
  rate: "",
  tax: "18",
  amount: 0,
});

const rowToItem = (r: any): BoqItem => ({
  Id: r.Id,
  _key: uid(),
  itemId: r.ItemId ?? "",
  itemName: r.ItemName ?? "",
  itemCode: r.ItemCode ?? "",
  description: r.Description ?? "",
  quantity: String(r.Quantity ?? ""),
  uomName: r.UomName ?? "",
  rate: String(r.Rate ?? ""),
  tax: String(r.TaxPct ?? "18"),
  amount: parseFloat(r.LineAmount) || 0,
});

const rowToActivity = (r: any): BoqActivity => ({
  Id: r.Id,
  _key: uid(),
  activityId: r.ActivityId ?? "",
  activityName: r.ActivityName ?? "",
  activityCode: r.ActivityCode ?? "",
  description: r.Description ?? "",
  quantity: String(r.Quantity ?? ""),
  uomName: r.UomName ?? "",
  rate: String(r.Rate ?? ""),
  tax: String(r.TaxPct ?? "18"),
  amount: parseFloat(r.LineAmount) || 0,
});

const buildPayload = (
  form: FormState,
  items: BoqItem[],
  activities: BoqActivity[],
) => ({
  BoqNo: form.BoqNo || undefined,
  BoqDate: form.BoqDate,
  CompanyId: form.CompanyId ? Number(form.CompanyId) : null,
  ProjectId: form.ProjectId ? Number(form.ProjectId) : null,
  Description: form.Description,
  Remarks: form.Remarks,
  DocTypeId: form.DocTypeId ? Number(form.DocTypeId) : null,
  finYear: form.FinYear || undefined,
  Status: form.Status,
  BoqItems: items.map((it) => ({
    itemId: it.itemId,
    itemName: it.itemName,
    itemCode: it.itemCode,
    description: it.description,
    quantity: it.quantity,
    uomName: it.uomName,
    unit: it.uomName,
    rate: it.rate,
    tax: it.tax,
    amount: it.amount,
  })),
  BoqActivities: activities.map((ac) => ({
    activityId: ac.activityId,
    activityName: ac.activityName,
    activityCode: ac.activityCode,
    description: ac.description,
    quantity: ac.quantity,
    uomName: ac.uomName,
    unit: ac.uomName,
    rate: ac.rate,
    tax: ac.tax,
    amount: ac.amount,
  })),
});

// ─────────────────────────────────────────────────────────────────────────────
// Field wrapper
// ─────────────────────────────────────────────────────────────────────────────

const Field = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && <p className="text-[11px] text-destructive">{error}</p>}
  </div>
);

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
      {label}
    </p>
    <p className="font-medium text-foreground">{value || "—"}</p>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Line Items Editor — redesigned
// ─────────────────────────────────────────────────────────────────────────────

type LineMode = "item" | "activity";

interface LineEditorProps {
  mode: LineMode;
  rows: BoqItem[] | BoqActivity[];
  uoms: UomOption[];
  itemOptions?: ItemOption[];
  activityOptions?: ActivityOption[];
  itemsTotal?: number;
  activitiesTotal?: number;
  onChange: (rows: any[]) => void;
  readOnly?: boolean;
  onTabChange?: (tab: "items" | "activities") => void;
  // Activity mode only — fired with the chosen activity's id so the parent
  // can auto-fetch and merge its linked items into the Items tab.
  onActivitySelected?: (activityId: string) => void;
}

const LineEditor: React.FC<LineEditorProps> = ({
  mode,
  rows,
  uoms,
  itemOptions = [],
  activityOptions = [],
  itemsTotal = 0,
  activitiesTotal = 0,
  onChange,
  readOnly,
  onTabChange,
  onActivitySelected,
}) => {
  const isItem = mode === "item";

  const upd = (idx: number, field: string, val: string) => {
    const next = (rows as any[]).map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: val };
      if (field === "quantity" || field === "rate") {
        updated.amount = calcAmount(updated.quantity, updated.rate);
      }
      return updated;
    });
    onChange(next);
  };

  const remove = (idx: number) =>
    onChange((rows as any[]).filter((_, i) => i !== idx));

  const add = () =>
    onChange([...(rows as any[]), isItem ? blankItem() : blankActivity()]);

  const subtotal = (rows as any[]).reduce(
    (s: number, r: any) => s + (parseFloat(r.amount) || 0),
    0,
  );
  const grandTotal = itemsTotal + activitiesTotal;

  return (
    <div
      style={{
        border: "1px solid hsl(var(--border))",
        borderRadius: "calc(var(--radius) + 2px)",
        overflow: "hidden",
        background: "hsl(var(--background))",
      }}
    >
      {/* ── Tab strip + add button ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "hsl(var(--muted))",
          borderBottom: "1px solid hsl(var(--border))",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "hsl(var(--border))",
            borderRadius: 8,
            padding: 3,
          }}
        >
          {(["items", "activities"] as const).map((t) => {
            const active = (t === "items") === isItem;
            return (
              <button
                key={t}
                onClick={() => onTabChange?.(t)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 14px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  transition: "all 0.1s",
                  background: active ? "hsl(var(--background))" : "transparent",
                  color: active
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground))",
                  boxShadow: active ? "0 0 0 0.5px hsl(var(--border))" : "none",
                }}
              >
                {t === "items" ? (
                  <Package size={12} />
                ) : (
                  <Settings2 size={12} />
                )}
                {t === "items" ? "Items" : "Activities"}
              </button>
            );
          })}
        </div>

        {!readOnly && (
          <button
            onClick={add}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              border: "1px solid hsl(var(--primary) / 0.35)",
              borderRadius: 6,
              background: "hsl(var(--primary) / 0.08)",
              color: "hsl(var(--primary))",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              transition: "background 0.1s",
            }}
          >
            <Plus size={13} />
            Add {isItem ? "item" : "activity"}
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
          }}
        >
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 108 }} />
            <col />
            {!readOnly && <col style={{ width: 36 }} />}
          </colgroup>

          <thead>
            <tr
              style={{
                background: "hsl(var(--muted))",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              {[
                "#",
                isItem ? "Item" : "Activity",
                "Code",
                "Spec / Notes",
                "Qty",
                "UOM",
                "Rate (₹)",
                "Tax %",
                "Amount (₹)",
                "Tax Amt (₹)",
              ].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: "0 8px",
                    height: 30,
                    textAlign:
                      i >= 4 && i !== 5 ? "right" : i === 0 ? "center" : "left",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "hsl(var(--muted-foreground))",
                    borderRight: "1px solid hsl(var(--border))",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {h}
                </th>
              ))}
              {!readOnly && <th style={{ borderRight: "none", padding: 0 }} />}
            </tr>
          </thead>

          <tbody>
            {(rows as any[]).length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 10 : 11}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "hsl(var(--muted-foreground))",
                    fontSize: 12,
                    fontStyle: "italic",
                  }}
                >
                  No {isItem ? "items" : "activities"} added yet.
                  {!readOnly && ' Click "Add item" to begin.'}
                </td>
              </tr>
            ) : (
              (rows as any[]).map((row, idx) => {
                const amt = parseFloat(row.amount) || 0;
                const codeVal = isItem
                  ? row.itemCode || ""
                  : row.activityCode || "";

                const isEven = idx % 2 === 1;

                return (
                  <tr
                    key={row._key ?? row.Id ?? idx}
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                      background: isEven
                        ? "hsl(var(--muted) / 0.4)"
                        : "hsl(var(--background))",
                    }}
                  >
                    {/* # */}
                    <td
                      style={{
                        textAlign: "center",
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                        height: 40,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        {idx + 1}
                      </span>
                    </td>

                    {/* Name select */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      {readOnly ? (
                        <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                          {(isItem ? row.itemName : row.activityName) || "—"}
                        </span>
                      ) : isItem ? (
                        <Select
                          value={row.itemId ? String(row.itemId) : ""}
                          onValueChange={(val) => {
                            const sel = itemOptions.find((o) => o.id === val);
                            if (!sel) return;
                            const matchedUom = uoms.find(
                              (u) => u.UOMCode === sel.uomCode,
                            );
                            const resolvedUom =
                              matchedUom?.UOMName ?? sel.uomCode;
                            onChange(
                              (rows as any[]).map((r, i) =>
                                i !== idx
                                  ? r
                                  : {
                                      ...r,
                                      itemId: sel.id,
                                      itemName: sel.name,
                                      itemCode: sel.code,
                                      uomName: resolvedUom,
                                    },
                              ),
                            );
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs border-border/60 focus:ring-1 focus:ring-primary/40 w-full">
                            <SelectValue placeholder="— Select item —" />
                          </SelectTrigger>
                          <SelectContent className="z-[300] max-h-60">
                            {itemOptions.map((o) => (
                              <SelectItem
                                key={o.id}
                                value={o.id}
                                className="text-xs"
                              >
                                {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select
                          value={row.activityId ? String(row.activityId) : ""}
                          onValueChange={(val) => {
                            const sel = activityOptions.find(
                              (o) => o.id === val,
                            );
                            if (!sel) return;
                            onChange(
                              (rows as any[]).map((r, i) =>
                                i !== idx
                                  ? r
                                  : {
                                      ...r,
                                      activityId: sel.id,
                                      activityName: sel.name,
                                      activityCode: sel.code,
                                    },
                              ),
                            );
                            onActivitySelected?.(sel.id);
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs border-border/60 focus:ring-1 focus:ring-primary/40 w-full">
                            <SelectValue placeholder="— Select activity —" />
                          </SelectTrigger>
                          <SelectContent className="z-[300] max-h-60">
                            {activityOptions.map((o) => (
                              <SelectItem
                                key={o.id}
                                value={o.id}
                                className="text-xs"
                              >
                                {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>

                    {/* Code */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: 10,
                          color: "hsl(var(--muted-foreground))",
                          background: "hsl(var(--muted))",
                          border: "0.5px solid hsl(var(--border))",
                          borderRadius: 3,
                          padding: "2px 5px",
                          display: "inline-block",
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {codeVal || <em>Auto</em>}
                      </span>
                    </td>

                    {/* Spec/Notes */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      {readOnly ? (
                        <span
                          style={{
                            fontSize: 11.5,
                            color: "hsl(var(--muted-foreground))",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                        >
                          {row.description || "—"}
                        </span>
                      ) : (
                        <input
                          value={row.description}
                          placeholder="Notes…"
                          onChange={(e) =>
                            upd(idx, "description", e.target.value)
                          }
                          style={{
                            width: "100%",
                            height: 30,
                            border: "0.5px solid hsl(var(--border))",
                            borderRadius: 4,
                            background: "hsl(var(--background))",
                            padding: "0 7px",
                            fontSize: 12,
                            color: "hsl(var(--foreground))",
                            outline: "none",
                            fontFamily: "inherit",
                          }}
                        />
                      )}
                    </td>

                    {/* Qty */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      {readOnly ? (
                        <span
                          style={{
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            fontSize: 12.5,
                            display: "block",
                            textAlign: "right",
                          }}
                        >
                          {row.quantity || "—"}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          value={row.quantity}
                          placeholder="0"
                          onChange={(e) => upd(idx, "quantity", e.target.value)}
                          style={{
                            width: "100%",
                            height: 30,
                            border: "0.5px solid hsl(var(--border))",
                            borderRadius: 4,
                            background: "hsl(var(--background))",
                            padding: "0 7px",
                            fontSize: 12,
                            color: "hsl(var(--foreground))",
                            outline: "none",
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                          }}
                        />
                      )}
                    </td>

                    {/* UOM */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      {readOnly ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: "hsl(var(--muted-foreground))",
                            fontWeight: 500,
                          }}
                        >
                          {row.uomName || "—"}
                        </span>
                      ) : (
                        <Select
                          value={row.uomName}
                          onValueChange={(val) => upd(idx, "uomName", val)}
                        >
                          <SelectTrigger className="h-8 text-xs border-border/60 focus:ring-1 focus:ring-primary/40 w-full">
                            <SelectValue placeholder="UOM" />
                          </SelectTrigger>
                          <SelectContent className="z-[300] max-h-52">
                            {uoms.map((u) => (
                              <SelectItem
                                key={String(u.Id)}
                                value={u.UOMName}
                                className="text-xs"
                              >
                                {u.UOMName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>

                    {/* Rate */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      {readOnly ? (
                        <span
                          style={{
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            fontSize: 12.5,
                            display: "block",
                            textAlign: "right",
                          }}
                        >
                          {row.rate || "—"}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          value={row.rate}
                          placeholder="0.00"
                          onChange={(e) => upd(idx, "rate", e.target.value)}
                          style={{
                            width: "100%",
                            height: 30,
                            border: "0.5px solid hsl(var(--border))",
                            borderRadius: 4,
                            background: "hsl(var(--background))",
                            padding: "0 7px",
                            fontSize: 12,
                            color: "hsl(var(--foreground))",
                            outline: "none",
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                          }}
                        />
                      )}
                    </td>

                    {/* Tax % */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                      }}
                    >
                      {readOnly ? (
                        <span
                          style={{
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            fontSize: 11.5,
                            display: "block",
                            textAlign: "right",
                            color: "hsl(var(--muted-foreground))",
                          }}
                        >
                          {row.tax}%
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={row.tax}
                          placeholder="18"
                          onChange={(e) => upd(idx, "tax", e.target.value)}
                          style={{
                            width: "100%",
                            height: 30,
                            border: "0.5px solid hsl(var(--border))",
                            borderRadius: 4,
                            background: "hsl(var(--background))",
                            padding: "0 7px",
                            fontSize: 12,
                            color: "hsl(var(--muted-foreground))",
                            outline: "none",
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                          }}
                        />
                      )}
                    </td>

                    {/* Amount */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 10px",
                        textAlign: "right",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "hsl(var(--primary))",
                        }}
                      >
                        {fmt(amt)}
                      </span>
                    </td>

                    {/* Tax Amt */}
                    <td
                      style={{
                        borderRight: !readOnly
                          ? "1px solid hsl(var(--border))"
                          : "none",
                        padding: "4px 10px",
                        textAlign: "right",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        {fmt((amt * (parseFloat(row.tax) || 0)) / 100)}
                      </span>
                    </td>

                    {/* Delete */}
                    {!readOnly && (
                      <td style={{ textAlign: "center", padding: "4px 4px" }}>
                        <button
                          onClick={() => remove(idx)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            width: 26,
                            height: 26,
                            borderRadius: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "hsl(var(--muted-foreground))",
                            transition: "all 0.1s",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color =
                              "hsl(var(--destructive))";
                            (
                              e.currentTarget as HTMLButtonElement
                            ).style.background =
                              "hsl(var(--destructive) / 0.08)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color =
                              "hsl(var(--muted-foreground))";
                            (
                              e.currentTarget as HTMLButtonElement
                            ).style.background = "none";
                          }}
                          aria-label={`Remove row ${idx + 1}`}
                        >
                          <X size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Subtotal footer */}
          {(rows as any[]).length > 0 && (
            <tfoot>
              <tr
                style={{
                  background: "hsl(var(--muted))",
                  borderTop: "1px solid hsl(var(--border))",
                }}
              >
                <td
                  colSpan={readOnly ? 9 : 10}
                  style={{
                    textAlign: "right",
                    padding: "6px 10px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "hsl(var(--muted-foreground))",
                    borderRight: "1px solid hsl(var(--border))",
                  }}
                >
                  {isItem ? "Items" : "Activities"} subtotal
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>
                  <span
                    style={{
                      fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "hsl(var(--primary))",
                    }}
                  >
                    {fmt(subtotal)}
                  </span>
                </td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Grand total bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderTop: "1px solid hsl(var(--border))",
          background: "hsl(var(--muted))",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Items
            </span>
            <span
              style={{
                fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12.5,
                fontWeight: 600,
                color: "hsl(var(--foreground))",
              }}
            >
              {fmt(itemsTotal)}
            </span>
          </div>
          <span style={{ color: "hsl(var(--border))", fontSize: 16 }}>+</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Activities
            </span>
            <span
              style={{
                fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12.5,
                fontWeight: 600,
                color: "hsl(var(--foreground))",
              }}
            >
              {fmt(activitiesTotal)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Grand total (excl. tax)
          </span>
          <span
            style={{
              fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
              fontVariantNumeric: "tabular-nums",
              fontSize: 20,
              fontWeight: 700,
              color: "hsl(var(--primary))",
              letterSpacing: "-0.5px",
            }}
          >
            {fmt(grandTotal)}
          </span>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  BoqNo: string;
  BoqDate: string;
  CompanyId: string;
  ProjectId: string;
  FinYear: string;
  Description: string;
  Remarks: string;
  DocTypeId: string;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
}

const canEditBoq = (status?: string | null) =>
  !status || status === "Draft" || status === "Rejected";

const defaultForm = (finYear?: string): FormState => ({
  BoqNo: "",
  BoqDate: new Date().toISOString().slice(0, 10),
  CompanyId: "",
  ProjectId: "",
  FinYear: finYear ?? "",
  Description: "",
  Remarks: "",
  DocTypeId: "",
  Status: "Draft",
});

const recordToForm = (r: BoqRecord): FormState => ({
  BoqNo: r.BoqNo ?? "",
  BoqDate: r.BoqDate?.slice(0, 10) ?? "",
  CompanyId: String(r.CompanyId ?? ""),
  ProjectId: String(r.ProjectId ?? ""),
  FinYear: (r as any).FinYear ?? "",
  Description: r.Description ?? "",
  Remarks: r.Remarks ?? "",
  DocTypeId: String(r.DocTypeId ?? ""),
  Status: r.Status ?? "Draft",
});

// ─────────────────────────────────────────────────────────────────────────────
// BOQ Form Modal
// ─────────────────────────────────────────────────────────────────────────────

interface FormModalProps {
  record: BoqRecord | null;
  companies: Company[];
  projects: Project[];
  docTypes: DocType[];
  uoms: UomOption[];
  itemOptions: ItemOption[];
  activityOptions: ActivityOption[];
  finYears: { id?: number | string; year: string; status?: string; locked?: boolean }[];
  activeFinYear?: string;
  onClose: () => void;
  onSaved: () => void;
}

const FormModal: React.FC<FormModalProps> = ({
  record,
  companies,
  projects,
  docTypes,
  uoms,
  itemOptions,
  activityOptions,
  finYears,
  activeFinYear,
  onClose,
  onSaved,
}) => {
  const isEdit = record !== null;
  const [form, setForm] = useState<FormState>(
    isEdit
      ? {
          ...recordToForm(record!),
          FinYear: (record as any)?.FinYear ?? activeFinYear ?? "",
        }
      : defaultForm(activeFinYear),
  );
  const [items, setItems] = useState<BoqItem[]>(
    (record?.BoqItems ?? []).map(rowToItem),
  );
  const [activities, setActivities] = useState<BoqActivity[]>(
    (record?.BoqActivities ?? []).map(rowToActivity),
  );
  const [lineTab, setLineTab] = useState<"items" | "activities">("items");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof FormState, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
  };

  // When company changes, reset the project selection
  const handleCompanyChange = (v: string) => {
    set("CompanyId", v);
    set("ProjectId", "");
  };

  // When an Activity line is added, auto-fetch the items linked to that
  // activity (Activity Master → "Add Item") and merge any not already on
  // the Items tab — quantity/rate are left blank for the user to fill in.
  const handleActivitySelected = async (activityId: string) => {
    try {
      const linked = await apiFetch(`/activity-items?activityId=${activityId}`);
      const linkedList: any[] = Array.isArray(linked) ? linked : [];
      if (linkedList.length === 0) return;

      setItems((prev) => {
        const existingIds = new Set(prev.map((it) => it.itemId));
        const newRows = linkedList
          .filter((li) => !existingIds.has(li.itemId))
          .map((li) => ({
            _key: uid(),
            itemId: li.itemId,
            itemName: li.itemName,
            itemCode: li.itemCode || "",
            description: "",
            quantity: "",
            uomName: li.uom || "",
            rate: "",
            tax: "18",
            amount: 0,
          }));
        if (newRows.length === 0) return prev;
        toast.success(
          `${newRows.length} item${newRows.length > 1 ? "s" : ""} auto-added from this activity`,
        );
        return [...prev, ...newRows];
      });
    } catch (err) {
      // Non-fatal — activity selection itself still succeeds either way.
      console.warn("Failed to auto-fetch activity items:", err);
    }
  };

  // Filter projects to only those belonging to the selected company.
  // If no company selected, show all projects.
  const filteredProjects = form.CompanyId
    ? projects.filter(
        (p) =>
          p.companyId == null || // show projects with no company link always
          String(p.companyId) === form.CompanyId,
      )
    : projects;

  const refreshBoqNo = async (docTypeId: string, finYear: string) => {
    if (!docTypeId) {
      set("BoqNo", "");
      return;
    }
    try {
      const nextDocNo = await fetchNextDocNumber(
        Number(docTypeId),
        finYear || undefined,
      );
      set("BoqNo", nextDocNo);
    } catch {
      toast.error("Failed to generate BOQ number preview");
    }
  };

  const handleDocTypeChange = async (value: string) => {
    set("DocTypeId", value);
    await refreshBoqNo(value, form.FinYear);
  };

  const handleFinYearChange = async (value: string) => {
    set("FinYear", value);
    if (form.DocTypeId) {
      await refreshBoqNo(form.DocTypeId, value);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.BoqDate) e.BoqDate = "Date is required";
    if (!form.CompanyId) e.CompanyId = "Company is required";
    if (!form.ProjectId) e.ProjectId = "Project is required";
    if (!form.DocTypeId) e.DocTypeId = "Document type is required";
    if (!form.FinYear) e.FinYear = "Financial year is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildPayload(form, items, activities);
      if (isEdit) {
        await apiFetch(`/boq/${record!.BoqID}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("BOQ updated");
      } else {
        await apiFetch("/boq", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("BOQ created");
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const itemsTotal = items.reduce(
    (s, r) => s + (parseFloat(String(r.amount)) || 0),
    0,
  );
  const activitiesTotal = activities.reduce(
    (s, r) => s + (parseFloat(String(r.amount)) || 0),
    0,
  );

  return (
    <div
      className="flex flex-col animate-in fade-in"
      style={{ minHeight: "calc(100vh - 112px)" }}
    >
      <div className="w-full flex flex-col">
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted px-2 font-semibold text-sm border border-border bg-transparent"
            >
              <ArrowLeft size={15} /> Back
            </Button>
            <div
              style={{ width: 1, height: 28, background: "hsl(var(--border))" }}
            />
            <div>
              <h2
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isEdit ? (
                  <Edit3 size={17} style={{ color: "hsl(var(--primary))" }} />
                ) : (
                  <FileText
                    size={17}
                    style={{ color: "hsl(var(--primary))" }}
                  />
                )}
                {isEdit
                  ? `Edit BOQ — ${record!.BoqNo}`
                  : "New Bill of Quantities"}
              </h2>
              <p
                style={{
                  fontSize: 12,
                  color: "hsl(var(--muted-foreground))",
                  marginTop: 2,
                }}
              >
                {isEdit
                  ? "Modify header, items and activities."
                  : "Fill in the header, then add items and/or activities."}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving}
              className="font-semibold text-sm px-5 py-2 h-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gradient-engineering inline-flex items-center gap-1.5 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg h-auto"
            >
              {saving ? (
                <RefreshCw className="animate-spin" size={14} />
              ) : (
                <Save size={14} />
              )}
              {isEdit ? "Update BOQ" : "Create BOQ"}
            </Button>
          </div>
        </div>

        {/* ── Body ── */}
        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* Section 1: Header */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid hsl(var(--border))",
                paddingBottom: 8,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: "hsl(var(--primary) / 0.1)",
                  color: "hsl(var(--primary))",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                1
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                BOQ Header
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field label="Financial Year" required error={errors.FinYear}>
                <Select
                  value={form.FinYear}
                  onValueChange={handleFinYearChange}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.FinYear ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="Select financial year" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {finYears
                      .filter((fy) => fy.status === "Active" && !fy.locked)
                      .sort((a, b) => b.year.localeCompare(a.year))
                      .map((fy) => (
                      <SelectItem
                        key={String(fy.id ?? fy.year)}
                        value={fy.year}
                      >
                        {fy.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Document Type" required error={errors.DocTypeId}>
                <Select
                  value={form.DocTypeId}
                  onValueChange={handleDocTypeChange}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.DocTypeId ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select type —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {docTypes.map((dt) => (
                      <SelectItem key={String(dt.id)} value={String(dt.id)}>
                        {dt.code}
                        {dt.description ? ` — ${dt.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="BOQ No">
                <Input
                  value={form.BoqNo || ""}
                  readOnly
                  placeholder="Auto generated"
                  className="h-10 bg-muted/50 text-muted-foreground cursor-not-allowed focus-visible:ring-0"
                />
              </Field>

              <Field label="BOQ Date" required error={errors.BoqDate}>
                <div className="relative">
                  <CalendarIcon
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    size={14}
                  />
                  <input
                    type="date"
                    value={form.BoqDate}
                    onChange={(e) => set("BoqDate", e.target.value)}
                    className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer${errors.BoqDate ? " border-destructive" : " border-border"}`}
                  />
                </div>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Company" required error={errors.CompanyId}>
                <Select
                  value={form.CompanyId}
                  onValueChange={handleCompanyChange}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.CompanyId ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select company —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {companies.map((c) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Project" required error={errors.ProjectId}>
                <Select
                  value={form.ProjectId}
                  onValueChange={(v) => set("ProjectId", v)}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.ProjectId ? "border-destructive" : ""}`}
                  >
                    <SelectValue
                      placeholder={
                        form.CompanyId
                          ? "— Select project —"
                          : "— Select company first —"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {filteredProjects.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Scope / Description">
                <Textarea
                  value={form.Description}
                  rows={2}
                  placeholder="Describe the scope of work…"
                  onChange={(e) => set("Description", e.target.value)}
                  className="resize-none"
                />
              </Field>
              <Field label="Remarks">
                <Textarea
                  value={form.Remarks}
                  rows={2}
                  placeholder="Internal notes…"
                  onChange={(e) => set("Remarks", e.target.value)}
                  className="resize-none"
                />
              </Field>
            </div>
          </div>

          {/* Section 2: Line items */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid hsl(var(--border))",
                paddingBottom: 8,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: "hsl(var(--primary) / 0.1)",
                  color: "hsl(var(--primary))",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                2
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Items & Activities
              </span>
            </div>

            <LineEditor
              mode={lineTab === "items" ? "item" : "activity"}
              rows={lineTab === "items" ? items : activities}
              uoms={uoms}
              itemOptions={itemOptions}
              activityOptions={activityOptions}
              itemsTotal={itemsTotal}
              activitiesTotal={activitiesTotal}
              onChange={
                lineTab === "items" ? (setItems as any) : (setActivities as any)
              }
              onTabChange={setLineTab}
              onActivitySelected={handleActivitySelected}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Detail / View Modal
// ─────────────────────────────────────────────────────────────────────────────

interface DetailModalProps {
  record: BoqRecord;
  uoms: UomOption[];
  onClose: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onRefresh: () => void;
  canDelete: boolean;
  canPrint: boolean;
}

const DetailModal: React.FC<DetailModalProps> = ({
  record,
  uoms,
  onClose,
  onEdit,
  onPrint,
  onRefresh,
  canDelete,
  canPrint,
}) => {
  const [lineTab, setLineTab] = useState<"items" | "activities">("items");
  const [acting, setActing] = useState(false);
  const navigate = useNavigate();
  const amendmentStatus = useAmendmentStatus("BOQ", record.BoqID, record.Status);

  const doDelete = async () => {
    if (!window.confirm("Delete this BOQ and all its items/activities?"))
      return;
    setActing(true);
    try {
      await apiFetch(`/boq/${record.BoqID}`, { method: "DELETE" });
      toast.success("BOQ deleted");
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    } finally {
      setActing(false);
    }
  };

  const doTransition = async (action: string) => {
    setActing(true);
    try {
      await apiFetch(`/api/boq/${record.BoqID}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      toast.success(
        action === "submit" ? "Submitted for approval" : "Status updated",
      );
      onRefresh();
    } catch (err: any) {
      toast.error(err.message ?? "Action failed");
    } finally {
      setActing(false);
    }
  };

  const itemsTotal = (record.BoqItems ?? []).reduce(
    (s, r) => s + (r.amount || 0),
    0,
  );
  const activitiesTotal = (record.BoqActivities ?? []).reduce(
    (s, r) => s + (r.amount || 0),
    0,
  );

  return (
    <div
      className="flex flex-col animate-in fade-in"
      style={{ minHeight: "calc(100vh - 112px)" }}
    >
      <div className="w-full flex flex-col">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted px-2 font-semibold text-sm border border-border bg-transparent"
            >
              <ArrowLeft size={15} /> Back
            </Button>
            <div
              style={{ width: 1, height: 28, background: "hsl(var(--border))" }}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "hsl(var(--primary))",
                fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {record.BoqNo || record.DocNo}
            </span>
            <ApprovalStatusChain table="BOQ" recordId={record.BoqID} />
            {amendmentStatus.isAmended && <AmendedBadge />}
          </div>

          {/* Right-side actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={doDelete}
                className="text-destructive hover:bg-destructive/10 border-destructive/30"
              >
                <Trash2 size={13} className="mr-1.5" /> Delete
              </Button>
            )}
            {record.Status === "Draft" && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={acting}
                  onClick={onEdit}
                >
                  <Edit3 size={13} className="mr-1.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  disabled={acting}
                  onClick={() => doTransition("submit")}
                >
                  Submit for Approval <Send size={12} className="ml-1.5" />
                </Button>
              </>
            )}
            {record.Status === "Approved" && (
              <Button
                variant="secondary"
                size="sm"
                disabled={acting}
                onClick={() =>
                  navigate("/engineering/amendment-menu", {
                    state: {
                      prefill: {
                        tab: "BOQ",
                        docId: record.BoqID,
                        docNo: record.BoqNo || record.DocNo,
                        projectName: record.ProjectName,
                        companyName: record.CompanyName,
                        totalAmount: record.TotalAmount,
                      },
                    },
                  })
                }
                className="text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
              >
                <FilePenLine size={13} className="mr-1.5" /> Amend
              </Button>
            )}
          </div>
        </div>

        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Status banner */}
          {record.Status !== "Draft" && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background:
                  record.Status === "Pending"
                    ? "hsl(38 90% 95%)"
                    : record.Status === "Approved"
                      ? "hsl(142 70% 95%)"
                      : "hsl(0 80% 96%)",
                border: `1px solid ${record.Status === "Pending" ? "hsl(38 80% 85%)" : record.Status === "Approved" ? "hsl(142 60% 85%)" : "hsl(0 70% 88%)"}`,
                color:
                  record.Status === "Pending"
                    ? "hsl(38 80% 35%)"
                    : record.Status === "Approved"
                      ? "hsl(142 60% 30%)"
                      : "hsl(0 70% 38%)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                {record.Status === "Pending"
                  ? "Awaiting admin approval from the Approval Inbox."
                  : null}
                {record.Status === "Approved" &&
                  `✓ Approved${record.ApprovedBy ? ` by ${record.ApprovedBy}` : ""}.`}
                {record.Status === "Rejected" &&
                  `✕ Rejected${record.RejectedBy ? ` by ${record.RejectedBy}` : ""}${record.RejectionNote ? ` — ${record.RejectionNote}` : ""}.`}
              </span>
            </div>
          )}

          {/* Header details grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <DetailRow label="Company" value={record.CompanyName} />
            <DetailRow label="Project" value={record.ProjectName} />
            <DetailRow label="BOQ Date" value={fmtDate(record.BoqDate)} />
            <DetailRow
              label="Document No"
              value={<span className="tabular-nums">{record.DocNo}</span>}
            />
            <DetailRow label="Created By" value={record.CreatedBy} />
            <DetailRow
              label="Total Amount"
              value={
                <span className="tabular-nums text-primary font-bold">
                  {fmt(record.TotalAmount)}
                </span>
              }
            />
          </div>

          {record.Description && (
            <div
              style={{
                background: "hsl(var(--muted))",
                borderLeft: "3px solid hsl(var(--primary))",
                borderRadius: "0 6px 6px 0",
                padding: "10px 14px",
                fontSize: 13,
              }}
            >
              {record.Description}
            </div>
          )}

          {/* Line items viewer */}
          <LineEditor
            mode={lineTab === "items" ? "item" : "activity"}
            rows={
              lineTab === "items"
                ? (record.BoqItems ?? []).map(rowToItem)
                : (record.BoqActivities ?? []).map(rowToActivity)
            }
            uoms={uoms}
            itemsTotal={itemsTotal}
            activitiesTotal={activitiesTotal}
            onChange={() => {}}
            readOnly
            onTabChange={setLineTab}
          />
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid hsl(var(--border))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            background: "hsl(var(--muted) / 0.5)",
            flexShrink: 0,
          }}
        >
          {canDelete && (
            <Button
              variant="outline"
              disabled={acting}
              onClick={doDelete}
              className="text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              <Trash2 size={14} className="mr-1.5" /> Delete
            </Button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {canPrint && (
              <Button variant="outline" onClick={onPrint} className="gap-1.5">
                <Printer size={14} /> Print
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {canEditBoq(record.Status) && (
              <>
                <Button variant="secondary" disabled={acting} onClick={onEdit}>
                  <Edit3 size={14} className="mr-1.5" /> Edit
                </Button>
                <ApprovalActions
                  status={record.Status}
                  recordId={record.BoqID}
                  endpoint="/api/boq"
                  onSuccess={() => onRefresh()}
                  submitOnly
                />
              </>
            )}
            {record.Status === "Approved" && (
              <Button
                variant="secondary"
                disabled={acting}
                onClick={() =>
                  navigate("/engineering/amendment-menu", {
                    state: {
                      prefill: {
                        tab: "BOQ",
                        docId: record.BoqID,
                        docNo: record.BoqNo || record.DocNo,
                        projectName: record.ProjectName,
                        companyName: record.CompanyName,
                        totalAmount: record.TotalAmount,
                      },
                    },
                  })
                }
                className="text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
              >
                <FilePenLine size={14} className="mr-1.5" /> Amend
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main BOQ Page
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "BoqNo",
    header: "BOQ No",
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold text-primary text-sm">
        {row.original.BoqNo || row.original.DocNo || "—"}
      </span>
    ),
  },
  {
    accessorKey: "BoqDate",
    header: "Date",
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">
        {fmtDate(getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "CompanyName",
    header: "Company",
    cell: ({ getValue }) => (
      <span className="text-sm">{String(getValue() || "—")}</span>
    ),
  },
  {
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">
        {String(getValue() || "—")}
      </span>
    ),
  },
  {
    accessorKey: "TotalAmount",
    header: "Total Amount",
    cell: ({ getValue }) => (
      <span className="text-sm font-semibold tabular-nums">
        {fmt(getValue() as number)}
      </span>
    ),
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => (
      <StatusBadge status={(getValue() as string) || "Draft"} />
    ),
  },
];

export default function BOQ() {
  const { finYears } = useFinYear();
  const rights = usePageRights("boq");
  const [page, setPage] = useState(1);
  const PAGE_LIMIT = 10;
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const searchRef = useRef<ReturnType<typeof setTimeout>>();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editRecord, setEditRecord] = useState<BoqRecord | null>(null);
  const [viewRecord, setViewRecord] = useState<BoqRecord | null>(null);

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;

  const {
    data: listData,
    isLoading: loading,
    refetch: loadList,
  } = useQuery({
    queryKey: ["boqs", page, search, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
        ...(search ? { search } : {}),
        ...(filterStatus && filterStatus !== "All"
          ? { status: filterStatus }
          : {}),
      });
      return apiFetch(`/boq?${params}`);
    },
  });

  const rows: BoqRecord[] = listData?.data ?? [];
  const totalPages = listData?.totalPages ?? 1;
  const total = listData?.total ?? 0;

  const totalValue = rows.reduce((s, r) => s + (r.TotalAmount ?? 0), 0);
  const countApproved = rows.filter((r) => r.Status === "Approved").length;
  const countPending = rows.filter((r) => r.Status === "Pending").length;

  const loadMasterData = useCallback(async () => {
    try {
      const [
        cosResult,
        prosResult,
        dtsResult,
        uomResult,
        itemResult,
        activityResult,
      ] = await Promise.allSettled([
        apiFetch("/enterprises/options?business_type=C"),
        apiFetch("/enterprises/options?business_type=P"),
        apiFetch("/document-type?module=BOQ"),
        apiFetch("/uom-master"),
        apiFetch("/item-master"),
        apiFetch("/activity-master"),
      ]);

      const cos = cosResult.status === "fulfilled" ? cosResult.value : [];
      const pros = prosResult.status === "fulfilled" ? prosResult.value : [];
      let dts = dtsResult.status === "fulfilled" ? dtsResult.value : [];
      const uomRes = uomResult.status === "fulfilled" ? uomResult.value : [];
      const itemRes = itemResult.status === "fulfilled" ? itemResult.value : [];
      const activityRes =
        activityResult.status === "fulfilled" ? activityResult.value : [];

      const filteredDocData = Array.isArray(dts?.data)
        ? dts.data
        : Array.isArray(dts)
          ? dts
          : [];
      if (filteredDocData.length === 0) {
        dts = await apiFetch("/document-type").catch(() => []);
      }

      const companyData = Array.isArray(cos?.data)
        ? cos.data
        : Array.isArray(cos)
          ? cos
          : [];
      setCompanies(
        companyData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.Id ?? item.EId ?? idx + 1),
          label:
            item.label ??
            item.name ??
            item.CompanyName ??
            item.EName ??
            "Unknown",
        })),
      );

      const projectData = Array.isArray(pros?.data)
        ? pros.data
        : Array.isArray(pros)
          ? pros
          : [];
      setProjects(
        projectData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.Id ?? item.EId ?? idx + 1),
          label:
            item.label ??
            item.name ??
            item.ProjectName ??
            item.EName ??
            "Unknown",
          // belongs_to or company_id links a project to its parent company
          companyId:
            item.company_id != null
              ? Number(item.company_id)
              : item.belongs_to != null
                ? Number(item.belongs_to)
                : null,
        })),
      );

      const docData = Array.isArray(dts?.data)
        ? dts.data
        : Array.isArray(dts)
          ? dts
          : [];
      setDocTypes(
        docData
          .filter((item: any) => {
            // Only keep doc types whose prefix/code actually starts with "BOQ"
            // This excludes cross-linked types like "Received Payment" that
            // happen to have BOQ in their links_to field.
            const prefix = String(
              item.code ??
                item.Prefix ??
                item.FullPrefix ??
                item.DocNoPrefix ??
                "",
            ).toUpperCase();
            return prefix.startsWith("BOQ");
          })
          .map((item: any, idx: number) => ({
            id: Number(item.id ?? item.TypeOfDocId ?? idx + 1),
            // Use Prefix/FullPrefix as the code shown left of the dash
            code: String(
              item.DocNoPrefix ??
                item.FullPrefix ??
                item.Prefix ??
                item.code ??
                "",
            ),
            // Description is the meaningful doc-type label (e.g. "Bill of Quantities")
            // EntryType is the accounting entry category — don't show it as the name
            name: String(item.Description ?? item.description ?? ""),
            description: String(item.Description ?? item.description ?? ""),
          })),
      );

      const uomData = Array.isArray(uomRes?.data)
        ? uomRes.data
        : Array.isArray(uomRes)
          ? uomRes
          : [];
      setUoms(
        uomData.map((item: any, idx: number) => ({
          Id: Number(item.Id ?? item.id ?? idx + 1),
          UOMName: item.UOMName ?? item.name ?? "",
          UOMCode: item.UOMCode ?? "",
        })),
      );

      const itemData: DbItem[] = Array.isArray(itemRes)
        ? itemRes
        : (itemRes?.data ?? []);
      setItemOptions(
        itemData.map((it) => ({
          id: String(it.M_Id),
          name: it.M_Name ?? "",
          code: it.M_code ?? "",
          uomCode: it.M_UOM ?? "",
        })),
      );

      const activityData: DbActivity[] = Array.isArray(activityRes)
        ? activityRes
        : (activityRes?.data ?? []);
      setActivityOptions(
        activityData
          .filter((a) => a.activity_type === 1 && a.is_active !== false)
          .map((a) => ({
            id: String(a.id),
            name: a.activity_name ?? "",
            code: String(a.id),
          })),
      );
    } catch (err) {
      toast.error("Failed to load dropdown data");
    }
  }, []);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  const onSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setPage(1), 350);
  };

  const openDetail = async (r: BoqRecord) => {
    try {
      const full = await apiFetch(`/boq/${r.BoqID}`);
      setViewRecord({
        ...full,
        BoqItems: Array.isArray(full.BoqItems) ? full.BoqItems : [],
        BoqActivities: Array.isArray(full.BoqActivities)
          ? full.BoqActivities
          : [],
      });
    } catch {
      setViewRecord({
        ...r,
        BoqItems: r.BoqItems ?? [],
        BoqActivities: r.BoqActivities ?? [],
      });
    }
  };

  const openEdit = (r: BoqRecord) => {
    if (!canEditBoq(r.Status)) {
      toast.error("Only Draft or Rejected BOQs can be edited.");
      return;
    }
    setViewRecord(null);
    setEditRecord(r);
    setShowForm(true);
  };

  const statuses = ["All", "Draft", "Pending", "Approved", "Rejected"];

  const handlePrint = (record: BoqRecord) => {
    const items = Array.isArray(record.BoqItems) ? record.BoqItems : [];
    const activities = Array.isArray(record.BoqActivities)
      ? record.BoqActivities
      : [];
    const itemTotal = items.reduce(
      (sum, row: any) =>
        sum + (Number(row.amount ?? row.LineAmount ?? row.Amount) || 0),
      0,
    );
    const activityTotal = activities.reduce(
      (sum, row: any) =>
        sum + (Number(row.amount ?? row.LineAmount ?? row.Amount) || 0),
      0,
    );
    const renderRows = (rows: any[], type: "item" | "activity") =>
      rows
        .map((row, idx) => {
          const name =
            type === "item"
              ? (row.itemName ?? row.ItemName)
              : (row.activityName ?? row.ActivityName);
          const code =
            type === "item"
              ? (row.itemCode ?? row.ItemCode)
              : (row.activityCode ?? row.ActivityCode);
          const qty = row.quantity ?? row.Quantity ?? "";
          const uom = row.uomName ?? row.UomName ?? "";
          const rate = Number(row.rate ?? row.Rate ?? 0);
          const amount = Number(
            row.amount ?? row.LineAmount ?? row.Amount ?? 0,
          );
          return safeHtml`<tr>
            <td>${idx + 1}</td>
            <td>${name || ""}</td>
            <td>${code || ""}</td>
            <td>${row.description ?? row.Description ?? ""}</td>
            <td class="num">${qty}</td>
            <td>${uom}</td>
            <td class="num">${fmt(rate)}</td>
            <td class="num">${fmt(amount)}</td>
          </tr>`;
        })
        .join("");

    const win = window.open("", "_blank", "width=980,height=720");
    if (!win) return;
    win.document.write(safeHtml`<!doctype html>
      <html>
        <head>
          <title>BOQ ${record.BoqNo || record.DocNo || record.BoqID}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 32px; }
            .head { display:flex; justify-content:space-between; gap:24px; border-bottom:2px solid #111827; padding-bottom:16px; margin-bottom:20px; }
            h1 { margin:0; font-size:22px; }
            .muted { color:#6b7280; font-size:12px; }
            .badge { display:inline-block; border:1px solid #d1d5db; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:700; }
            .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px 18px; margin-bottom:18px; }
            .label { font-size:10px; text-transform:uppercase; color:#6b7280; letter-spacing:.06em; }
            .value { font-size:13px; font-weight:600; margin-top:3px; }
            table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
            th, td { border:1px solid #d1d5db; padding:7px; vertical-align:top; }
            th { background:#f3f4f6; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.06em; }
            .num { text-align:right; white-space:nowrap; }
            .section { margin-top:18px; }
            .total { display:flex; justify-content:flex-end; gap:28px; margin-top:16px; font-weight:700; }
            @media print { body { margin: 18mm; } }
          </style>
        </head>
        <body>
          <div class="head">
            <div>
              <h1>Bill of Quantities</h1>
              <div class="muted">${record.BoqNo || record.DocNo || `#${record.BoqID}`}</div>
            </div>
            <div><span class="badge">${record.Status || "Draft"}</span></div>
          </div>
          <div class="grid">
            <div><div class="label">Company</div><div class="value">${record.CompanyName || ""}</div></div>
            <div><div class="label">Project</div><div class="value">${record.ProjectName || ""}</div></div>
            <div><div class="label">Date</div><div class="value">${fmtDate(record.BoqDate)}</div></div>
            <div><div class="label">Created By</div><div class="value">${record.CreatedBy || ""}</div></div>
            <div><div class="label">Document No</div><div class="value">${record.DocNo || record.BoqNo || ""}</div></div>
            <div><div class="label">Total</div><div class="value">${fmt(record.TotalAmount || itemTotal + activityTotal)}</div></div>
          </div>
          ${record.Description ? raw(safeHtml`<p>${record.Description}</p>`) : ""}
          <div class="section">
            <h3>Items</h3>
            <table><thead><tr><th>#</th><th>Item</th><th>Code</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${raw(renderRows(items, "item") || '<tr><td colspan="8">No items</td></tr>')}</tbody></table>
          </div>
          <div class="section">
            <h3>Activities</h3>
            <table><thead><tr><th>#</th><th>Activity</th><th>Code</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${raw(renderRows(activities, "activity") || '<tr><td colspan="8">No activities</td></tr>')}</tbody></table>
          </div>
          <div class="total">
            <span>Items: ${fmt(itemTotal)}</span>
            <span>Activities: ${fmt(activityTotal)}</span>
            <span>Grand Total: ${fmt(record.TotalAmount || itemTotal + activityTotal)}</span>
          </div>
        </body>
      </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  const enrichedColumns = [
    ...COLUMNS,
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }: any) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openDetail(row.original)}
            className="h-8 w-8 p-0"
          >
            <Eye size={14} />
          </Button>
          {rights.canPrint && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-violet-600"
              onClick={async () => {
                const full = await apiFetch(`/boq/${row.original.BoqID}`).catch(
                  () => row.original,
                );
                handlePrint({
                  ...full,
                  BoqItems: full.BoqItems ?? [],
                  BoqActivities: full.BoqActivities ?? [],
                });
              }}
            >
              <Printer size={14} />
            </Button>
          )}
          {canEditBoq(row.original.Status) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-primary"
              onClick={async () => {
                const full = await apiFetch(`/boq/${row.original.BoqID}`).catch(
                  () => row.original,
                );
                openEdit({
                  ...full,
                  BoqItems: full.BoqItems ?? [],
                  BoqActivities: full.BoqActivities ?? [],
                });
              }}
            >
              <Edit3 size={14} />
            </Button>
          )}
          <ApprovalActions
            status={row.original.Status}
            recordId={row.original.BoqID}
            endpoint="/api/boq"
            onSuccess={() => loadList()}
            submitOnly
          />
        </div>
      ),
    },
  ];

  // Summary stat cards config
  const stats = [
    { label: "Total BOQs", value: total, color: "#3b82f6" },
    { label: "Portfolio Value", value: fmt(totalValue), color: "#10b981" },
    { label: "Pending Approval", value: countPending, color: "#f59e0b" },
    { label: "Approved", value: countApproved, color: "#8b5cf6" },
  ];

  return (
    <>
      <Breadcrumbs items={["Engineering", "Transaction", "BOQ"]} />

      {/* ── Inline Form (create / edit) ── */}
      {showForm && (
        <FormModal
          record={editRecord}
          companies={companies}
          projects={projects}
          docTypes={docTypes}
          uoms={uoms}
          itemOptions={itemOptions}
          activityOptions={activityOptions}
          finYears={finYears}
          activeFinYear={activeFinYear}
          onClose={() => {
            setShowForm(false);
            setEditRecord(null);
          }}
          onSaved={() => loadList()}
        />
      )}

      {/* ── Inline Detail / View ── */}
      {!showForm && viewRecord && (
        <DetailModal
          record={viewRecord}
          uoms={uoms}
          onClose={() => setViewRecord(null)}
          onEdit={() => openEdit(viewRecord)}
          onPrint={() => handlePrint(viewRecord)}
          onRefresh={() => {
            setViewRecord(null);
            loadList();
          }}
          canDelete={rights.canDelete}
          canPrint={rights.canPrint}
        />
      )}

      {/* ── List page ── */}
      {!showForm && !viewRecord && (
        <EngineeringShell
          title="Bill of Quantities"
          subtitle="Manage material items and work activities with structured cost estimation"
          icon={FileText}
          action={
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => loadList()}
                disabled={loading}
                className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={`transition-transform duration-500 ${loading ? "animate-spin" : "group-hover:rotate-180"}`}
                />
                Refresh
              </button>
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setEditRecord(null);
                    setShowForm(true);
                  }}
                  className="gradient-engineering inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg transition-all"
                >
                  <Plus size={13} /> New BOQ
                </button>
              )}
            </div>
          }
        >
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderTop: `3px solid ${s.color}`,
                  borderRadius: "calc(var(--radius) + 2px)",
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    marginTop: 4,
                    fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Table card */}
          <Card className="shadow-sm">
            <CardHeader className="p-4 border-b flex flex-col md:flex-row md:items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  placeholder="Search BOQ no, company, project…"
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {statuses.map((s) => (
                  <Button
                    key={s}
                    variant={filterStatus === s ? "default" : "outline"}
                    size="sm"
                    className={`h-8 rounded-full text-xs font-semibold${filterStatus === s ? " gradient-engineering text-white border-0" : ""}`}
                    onClick={() => {
                      setFilterStatus(s);
                      setPage(1);
                    }}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground text-sm gap-2">
                  <RefreshCw size={15} className="animate-spin" /> Loading BOQs…
                </div>
              ) : (
                <>
                  <DataTable
                    data={rows}
                    columns={enrichedColumns}
                    searchable={false}
                    paginated={false}
                    emptyMessage="No BOQs found. Adjust your filters or create a new one."
                  />
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t p-4 text-sm">
                      <span className="text-muted-foreground">
                        Page {page} of {totalPages} ({total} records)
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page === 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          Prev
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page === totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </EngineeringShell>
      )}
    </>
  );
}