// The BOQ's Equipment tab: machines and plant from the Equipment Master, the activity each serves, qty × rate.
// Rendered inside LineEditor (same tab strip and totals footer as Items and Activities).
import React from "react";
import { X } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import type { BoqActivity, BoqEquipmentLine, EquipmentOption } from "./config";
import { fmt } from "./config";

const RULE = "1px solid hsl(var(--foreground) / 0.2)";
const CELL: React.CSSProperties = { borderRight: RULE, padding: "8px 10px", verticalAlign: "middle" };
const INPUT: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 8px",
  border: "1px solid hsl(var(--foreground) / 0.3)",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  fontSize: 12,
  outline: "none",
  borderRadius: 0,
};
const NUM: React.CSSProperties = { ...INPUT, textAlign: "right", fontVariantNumeric: "tabular-nums" };

// [heading, align, width px]
const COLS: [string, "left" | "right" | "center", number][] = [
  ["#", "center", 44],
  ["Equipment", "left", 230],
  ["For Activity", "left", 200],
  ["Spec / Notes", "left", 170],
  ["Qty", "right", 96],
  ["UOM", "left", 100],
  ["Rate (₹)", "right", 120],
  ["Tax %", "right", 90],
  ["Amount (₹)", "right", 130],
  ["Tax Amt (₹)", "right", 120],
];

const amountOf = (qty: string, rate: string) => Math.round((parseFloat(qty) || 0) * (parseFloat(rate) || 0) * 100) / 100;

export function EquipmentLines({
  rows,
  options,
  boqActivities,
  onChange,
  readOnly,
}: {
  rows: BoqEquipmentLine[];
  options: EquipmentOption[];
  boqActivities: BoqActivity[];
  onChange: (rows: BoqEquipmentLine[]) => void;
  readOnly?: boolean;
}) {
  const set = (idx: number, patch: Partial<BoqEquipmentLine>) =>
    onChange(
      rows.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        return { ...next, amount: amountOf(next.quantity, next.rate) };
      }),
    );

  const pick = (idx: number, id: string) => {
    const eq = options.find((o) => o.id === id);
    if (!eq) return;
    const r = rows[idx];
    // The master's unit and standard rate are the defaults; a rate already typed on the line is kept.
    set(idx, {
      equipmentId: eq.id,
      equipmentName: eq.name,
      equipmentCode: eq.code,
      uomName: eq.uom || r.uomName,
      rate: r.rate !== "" ? r.rate : eq.rate != null ? String(eq.rate) : "",
    });
  };

  const activityChoices = boqActivities.filter((a) => a.activityId);
  const width = COLS.reduce((t, c) => t + c[2], 0) + (readOnly ? 0 : 48);

  return (
    <div className="boq-lines-scroll" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: width, tableLayout: "fixed", borderCollapse: "collapse" }}>
        <colgroup>
          {COLS.map((c, i) => <col key={i} style={{ width: c[2] }} />)}
          {!readOnly && <col style={{ width: 48 }} />}
        </colgroup>
        <thead>
          <tr style={{ background: "hsl(var(--card))", borderBottom: RULE }}>
            {COLS.map(([h, align]) => (
              <th
                key={h}
                style={{
                  padding: "0 10px",
                  height: 38,
                  textAlign: align,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "hsl(var(--muted-foreground))",
                  borderRight: RULE,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                {h}
              </th>
            ))}
            {!readOnly && <th style={{ padding: 0 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const tax = Math.round(r.amount * (parseFloat(r.tax) || 0)) / 100;
            // An equipment record switched off later still shows on the line that already uses it.
            const choices = options
              .filter((o) => o.isActive || o.id === r.equipmentId)
              .map((o) => ({ value: o.id, label: o.code ? `${o.name} (${o.code})` : o.name }));
            const actName = activityChoices.find((a) => a.activityId === r.activityId)?.activityName || r.activityName;
            return (
              <tr key={r._key ?? r.Id ?? idx} style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.12)", background: idx % 2 ? "hsl(var(--foreground) / 0.02)" : undefined }}>
                <td style={{ ...CELL, textAlign: "center", fontSize: 11, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{idx + 1}</td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.equipmentName || "—"}</span>
                  ) : (
                    <SearchableSelect
                      sheet
                      value={r.equipmentId}
                      onChange={(v) => pick(idx, v)}
                      options={choices}
                      placeholder="— Select equipment —"
                      searchPlaceholder="Search equipment…"
                      className="h-8 text-xs"
                    />
                  )}
                </td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ fontSize: 12 }}>{actName || "—"}</span>
                  ) : (
                    <select
                      value={r.activityId}
                      onChange={(e) => {
                        const a = activityChoices.find((x) => x.activityId === e.target.value);
                        set(idx, { activityId: e.target.value, activityName: a?.activityName ?? "" });
                      }}
                      style={INPUT}
                      aria-label="For activity"
                    >
                      <option value="">— None —</option>
                      {activityChoices.map((a) => (
                        <option key={a.activityId} value={a.activityId}>
                          {a.activityName}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{r.description || "—"}</span>
                  ) : (
                    <input value={r.description} onChange={(e) => set(idx, { description: e.target.value })} placeholder="Notes…" style={INPUT} />
                  )}
                </td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ display: "block", textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{r.quantity || "—"}</span>
                  ) : (
                    <input type="number" min="0" step="any" value={r.quantity} onChange={(e) => set(idx, { quantity: e.target.value })} placeholder="0" style={NUM} />
                  )}
                </td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ fontSize: 12 }}>{r.uomName || "—"}</span>
                  ) : (
                    <input value={r.uomName} onChange={(e) => set(idx, { uomName: e.target.value })} placeholder="Hour" style={INPUT} maxLength={50} />
                  )}
                </td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ display: "block", textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{r.rate ? fmt(parseFloat(r.rate)) : "—"}</span>
                  ) : (
                    <input type="number" min="0" step="any" value={r.rate} onChange={(e) => set(idx, { rate: e.target.value })} placeholder="0.00" style={NUM} />
                  )}
                </td>
                <td style={CELL}>
                  {readOnly ? (
                    <span style={{ display: "block", textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{r.tax || "0"}%</span>
                  ) : (
                    <input type="number" min="0" max="100" step="any" value={r.tax} onChange={(e) => set(idx, { tax: e.target.value })} style={NUM} />
                  )}
                </td>
                <td style={{ ...CELL, textAlign: "right", fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(r.amount)}</td>
                <td style={{ ...CELL, textAlign: "right", fontSize: 12, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{fmt(tax)}</td>
                {!readOnly && (
                  <td style={{ padding: 0, textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                      title="Remove equipment"
                      aria-label="Remove equipment"
                      style={{ width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}
                    >
                      <X size={14} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
