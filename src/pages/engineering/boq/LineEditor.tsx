// The BOQ lines: items or activities, quantities, rates and amounts.
import { Plus, X, Package, Settings2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import React from "react";
import { BoqItem, BoqActivity, UomOption, ItemOption, ActivityOption, ActivityGroupOption, fmt, calcAmount, activityBasis, fmtQty, blankItem, blankActivity } from "./config";

export type LineMode = "item" | "activity";

export interface LineEditorProps {
  mode: LineMode;
  rows: BoqItem[] | BoqActivity[];
  uoms: UomOption[];
  itemOptions?: ItemOption[];
  activityOptions?: ActivityOption[];
  activityGroups?: ActivityGroupOption[];
  /** Item mode: the activities already added to this BOQ, offered in the "Activity" column. */
  boqActivities?: BoqActivity[];
  itemsTotal?: number;
  activitiesTotal?: number;
  onChange: (rows: any[]) => void;
  readOnly?: boolean;
  onTabChange?: (tab: "items" | "activities") => void;
  // Activity mode only — fired with the chosen activity's id so the parent
  // can auto-fetch and merge its linked items into the Items tab.
  onActivitySelected?: (activityId: string) => void;
}

export const LineEditor: React.FC<LineEditorProps> = ({
  mode,
  rows,
  uoms,
  itemOptions = [],
  activityOptions = [],
  activityGroups = [],
  boqActivities = [],
  itemsTotal = 0,
  activitiesTotal = 0,
  onChange,
  readOnly,
  onTabChange,
  onActivitySelected,
}) => {
  const isItem = mode === "item";

  // The group an activity row is under: the one picked, else the one the saved
  // activity belongs to (BOQs made before groups were recorded).
  const rowGroupId = (r: any): string =>
    r.groupId || activityOptions.find((o) => o.id === r.activityId)?.groupId || "";

  const upd = (idx: number, field: string, val: string) => {
    const next = (rows as any[]).map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: val };
      // Activities: Total Rate is the whole price, so Amount = Total Rate
      // (Per Activity Price = Total Rate / Total Area is shown separately).
      if (!isItem) {
        if (field === "rate") updated.amount = parseFloat(val) || 0;
      } else if (field === "quantity" || field === "rate") {
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
  // Every mode shows 12 columns (+ delete when editable): items get "For Activity"
  // and "Per Unit Qty"; activities get "Area" and "Per Activity Price".
  // Activities also get a leading "Activity Group" column.
  const colCount = 12 + (readOnly ? 0 : 1);

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
          {(["activities", "items"] as const).map((t) => {
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
            {!isItem && <col style={{ width: 170 }} />}
            <col style={{ width: 180 }} />
            {isItem && <col style={{ width: 170 }} />}
            <col style={{ width: 80 }} />
            <col style={{ width: 120 }} />
            {isItem && <col style={{ width: 72 }} />}
            <col style={{ width: isItem ? 130 : 84 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 108 }} />
            {!isItem && <col style={{ width: 130 }} />}
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
              {(
                [
                  ["#", "center"],
                  ...(!isItem ? [["Activity Group", "left"]] : []),
                  [isItem ? "Item" : "Activity", "left"],
                  ...(isItem ? [["For Activity", "left"]] : []),
                  ["Code", "left"],
                  ["Spec / Notes", "left"],
                  ...(isItem ? [["Item Qty", "right"]] : []),
                  [isItem ? "Per Unit Qty" : "Total Area", "right"],
                  ["UOM", "left"],
                  [isItem ? "Rate (₹)" : "Total Rate (₹)", "right"],
                  ["Tax %", "right"],
                  ["Amount (₹)", "right"],
                  ...(!isItem ? [["Per Activity Price", "right"]] : []),
                  ["Tax Amt (₹)", "right"],
                ] as [string, "left" | "right" | "center"][]
              ).map(([h, align]) => {
                return (
                <th
                  key={h}
                  style={{
                    padding: "0 8px",
                    height: 30,
                    textAlign: align,
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
                );
              })}
              {!readOnly && <th style={{ borderRight: "none", padding: 0 }} />}
            </tr>
          </thead>

          <tbody>
            {(rows as any[]).length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
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

                    {/* Activity Group (activities only) — chosen before the activity */}
                    {!isItem && (
                      <td
                        style={{
                          borderRight: "1px solid hsl(var(--border))",
                          padding: "4px 6px",
                        }}
                      >
                        {readOnly ? (
                          <span style={{ fontSize: 12.5 }}>
                            {row.groupName ||
                              activityGroups.find((g) => g.id === row.groupId)?.name ||
                              "—"}
                          </span>
                        ) : (
                          <Select
                            value={rowGroupId(row) || ""}
                            onValueChange={(val) => {
                              const g = activityGroups.find((x) => x.id === val);
                              if (!g) return;
                              // A different group invalidates the activity picked under the old one.
                              onChange(
                                (rows as any[]).map((r, i) =>
                                  i !== idx
                                    ? r
                                    : {
                                        ...r,
                                        groupId: g.id,
                                        groupName: g.name,
                                        ...(rowGroupId(r) !== g.id
                                          ? { activityId: "", activityName: "", activityCode: "" }
                                          : {}),
                                      },
                                ),
                              );
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs border-foreground/30 w-full">
                              <SelectValue placeholder="— Select group —" />
                            </SelectTrigger>
                            <SelectContent className="z-[300] max-h-60">
                              {activityGroups.map((g) => (
                                <SelectItem key={g.id} value={g.id} className="text-xs">
                                  {g.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    )}

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
                          <SelectTrigger className="h-8 text-xs border-foreground/30 w-full">
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
                          disabled={!rowGroupId(row)}
                          value={row.activityId ? String(row.activityId) : ""}
                          onValueChange={(val) => {
                            const sel = activityOptions.find(
                              (o) => o.id === val && o.groupId === rowGroupId(row),
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
                          <SelectTrigger className="h-8 text-xs border-foreground/30 w-full">
                            <SelectValue
                              placeholder={
                                rowGroupId(row)
                                  ? "— Select activity —"
                                  : "Select a group first"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="z-[300] max-h-60">
                            {activityOptions
                              .filter((o) => o.groupId === rowGroupId(row))
                              .map((o) => (
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

                    {/* For Activity (items only) */}
                    {isItem && (
                      <td
                        style={{
                          borderRight: "1px solid hsl(var(--border))",
                          padding: "4px 6px",
                        }}
                      >
                        {readOnly ? (
                          <span style={{ fontSize: 12 }}>
                            {row.activityName || "—"}
                          </span>
                        ) : (
                          <Select
                            value={row.activityId ? String(row.activityId) : "__none"}
                            onValueChange={(val) => {
                              const sel = boqActivities.find((a) => a.activityId === val);
                              onChange(
                                (rows as any[]).map((r, i) =>
                                  i !== idx
                                    ? r
                                    : {
                                        ...r,
                                        activityId: sel ? sel.activityId : "",
                                        activityName: sel ? sel.activityName : "",
                                      },
                                ),
                              );
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs border-foreground/30 w-full">
                              <SelectValue placeholder="— None —" />
                            </SelectTrigger>
                            <SelectContent className="z-[300] max-h-60">
                              <SelectItem value="__none" className="text-xs">
                                — None —
                              </SelectItem>
                              {boqActivities
                                .filter(
                                  (a, k, arr) =>
                                    a.activityId &&
                                    arr.findIndex((b) => b.activityId === a.activityId) === k,
                                )
                                .map((a) => (
                                  <SelectItem key={a.activityId} value={a.activityId} className="text-xs">
                                    {a.activityName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    )}

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

                    {/* Qty (items only — an activity is sized by its Total Area) */}
                    {isItem && (
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

                    )}

                    {/* Per Unit Qty (items) / Total Area (activities) */}
                    <td
                      style={{
                        borderRight: "1px solid hsl(var(--border))",
                        padding: "4px 6px",
                        textAlign: "right",
                      }}
                    >
                      {isItem ? (
                        (() => {
                          const act = row.activityId
                            ? boqActivities.find((a) => a.activityId === row.activityId)
                            : undefined;
                          const basis = activityBasis(act);
                          const q = parseFloat(row.quantity) || 0;
                          if (!act || basis.value <= 0 || q <= 0) {
                            return (
                              <span
                                title={
                                  !act
                                    ? "Pick the activity this item is for"
                                    : "Enter the activity's Total Area and this item's quantity"
                                }
                                style={{ color: "hsl(var(--muted-foreground))" }}
                              >
                                —
                              </span>
                            );
                          }
                          return (
                            <span
                              title={`${fmtQty(q)} ÷ ${fmtQty(basis.value)} (activity ${basis.kind === "area" ? "area" : "quantity"})`}
                              style={{
                                fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                                fontVariantNumeric: "tabular-nums",
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: "hsl(var(--primary))",
                              }}
                            >
                              {fmtQty(q / basis.value)}
                              <span style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>
                                {` ${row.uomName || ""} / ${basis.kind === "area" ? "area" : "unit"}`}
                              </span>
                            </span>
                          );
                        })()
                      ) : readOnly ? (
                        <span
                          style={{
                            fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                            fontVariantNumeric: "tabular-nums",
                            fontSize: 12.5,
                          }}
                        >
                          {row.area || "—"}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          value={row.area ?? ""}
                          placeholder="0"
                          onChange={(e) => upd(idx, "area", e.target.value)}
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
                          <SelectTrigger className="h-8 text-xs border-foreground/30 w-full">
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

                    {/* Per Activity Price (activities only): amount ÷ area (or ÷ qty) */}
                    {!isItem && (
                      <td
                        style={{
                          borderRight: "1px solid hsl(var(--border))",
                          padding: "4px 10px",
                          textAlign: "right",
                        }}
                      >
                        {(() => {
                          const basis = activityBasis(row);
                          if (basis.value <= 0 || amt <= 0) {
                            return <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>;
                          }
                          return (
                            <span
                              title={`${fmt(amt)} ÷ ${fmtQty(basis.value)} (${basis.kind === "area" ? "total area" : "total qty"})`}
                              style={{
                                fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                                fontVariantNumeric: "tabular-nums",
                                fontSize: 12.5,
                                fontWeight: 600,
                              }}
                            >
                              {fmt(amt / basis.value)}
                              <span style={{ fontSize: 9.5, fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>
                                {basis.kind === "area" ? " / area" : " / unit"}
                              </span>
                            </span>
                          );
                        })()}
                      </td>
                    )}

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
                  colSpan={colCount - 2}
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
