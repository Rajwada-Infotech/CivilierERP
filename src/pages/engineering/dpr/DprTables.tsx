// The three sections of the report: BOQs, work orders (each opens to its activities) and work done.
// Company and project share a column, as do who created it and when, so each table fits the sheet; a narrow
// screen scrolls the table, never the page.
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { type BOQRow, type WorkDoneRow, type WorkOrderRow, LBL, RULE, counted, fmt, fmtDate, fmtNum, fmtTime } from "./config";

const TH = `${LBL} px-3 py-2.5 whitespace-nowrap`;
const TD = "px-3 py-2.5 align-top text-xs";
const FOOT_RULE = { borderTop: "1px solid hsl(var(--foreground) / 0.4)" };

const Status: React.FC<{ status: string }> = ({ status }) => <SheetMark text={status || "Draft"} tone={statusTone(status || "Draft")} />;

const Two: React.FC<{ top?: React.ReactNode; sub?: React.ReactNode; mono?: boolean }> = ({ top, sub, mono }) => (
  <div className="leading-tight min-w-0">
    <p className={`text-foreground truncate ${mono ? "font-heading tabular-nums font-semibold" : ""}`}>{top || "—"}</p>
    {sub ? <p className="text-[0.6875rem] text-muted-foreground truncate">{sub}</p> : null}
  </div>
);

const Who: React.FC<{ by: string; at: string }> = ({ by, at }) => <Two top={<span className="text-muted-foreground">{by || "—"}</span>} sub={fmtTime(at)} />;

/** One titled section of the sheet: name, how many, what they are worth. */
export const Section: React.FC<{ title: string; count: number; total: number; totalLabel: string; children: React.ReactNode }> = ({ title, count, total, totalLabel, children }) => (
  <section className="bg-card" style={{ border: RULE }}>
    <div className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
      <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
        {title} <span className="text-muted-foreground font-semibold">· {count}</span>
      </h3>
      <p className="text-xs text-muted-foreground">
        {totalLabel} <span className="font-heading font-bold tabular-nums text-foreground">{fmt(total)}</span>
      </p>
    </div>
    {children}
  </section>
);

const Empty: React.FC<{ label: string }> = ({ label }) => <p className="px-4 py-8 text-center text-sm text-muted-foreground">{label}</p>;

const liveTotal = <T extends { Status: string }>(rows: T[], v: (r: T) => number | null | undefined) =>
  rows.filter((r) => counted(r.Status)).reduce((s, r) => s + (Number(v(r)) || 0), 0);

export function BOQTable({ rows }: { rows: BOQRow[] }) {
  if (!rows.length) return <Empty label="No BOQs were created on this date." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.25)" }}>
            <th className={`${TH} text-left`}>BOQ</th>
            <th className={`${TH} text-left`}>Company / project</th>
            <th className={`${TH} text-left`}>Description</th>
            <th className={`${TH} text-right`}>Value</th>
            <th className={`${TH} text-left`}>Status</th>
            <th className={`${TH} text-left`}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.BoqID} className="border-b border-foreground/10 hover:bg-primary/5">
              <td className={TD}><Two mono top={r.DocNo || r.BoqNo || `BOQ-${r.BoqID}`} sub={fmtDate(r.BoqDate)} /></td>
              <td className={`${TD} max-w-[220px]`}><Two top={r.ProjectName} sub={r.CompanyName} /></td>
              <td className={`${TD} max-w-[260px] text-muted-foreground`}><span className="line-clamp-2">{r.Description || "—"}</span></td>
              <td className={`${TD} text-right font-semibold tabular-nums whitespace-nowrap ${counted(r.Status) ? "text-foreground" : "text-muted-foreground line-through"}`}>{fmt(r.TotalAmount)}</td>
              <td className={TD}><Status status={r.Status} /></td>
              <td className={TD}><Who by={r.CreatedBy} at={r.CreatedAt} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={FOOT_RULE}>
            <td colSpan={3} className={`${TD} ${LBL}`}>{rows.length} BOQ{rows.length !== 1 ? "s" : ""}</td>
            <td className={`${TD} text-right font-bold tabular-nums text-foreground whitespace-nowrap`}>{fmt(liveTotal(rows, (r) => r.TotalAmount))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function WorkOrderTable({ rows }: { rows: WorkOrderRow[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (!rows.length) return <Empty label="No work orders were created on this date." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.25)" }}>
            <th className="w-8" />
            <th className={`${TH} text-left`}>Work order</th>
            <th className={`${TH} text-left`}>Company / project</th>
            <th className={`${TH} text-left`}>Contractor / BOQ</th>
            <th className={`${TH} text-right`}>Activities</th>
            <th className={`${TH} text-right`}>Value</th>
            <th className={`${TH} text-left`}>Status</th>
            <th className={`${TH} text-left`}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.Id);
            return (
              <React.Fragment key={r.Id}>
                <tr className={`border-b border-foreground/10 hover:bg-primary/5 ${isOpen ? "bg-primary/5" : ""}`}>
                  <td className="px-2 py-2.5 align-top">
                    {r.activities.length > 0 && (
                      <button onClick={() => toggle(r.Id)} className="p-0.5 text-muted-foreground hover:text-foreground" title={isOpen ? "Hide activities" : "Show activities"}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                  </td>
                  <td className={TD}><Two mono top={r.DocNo || r.DocumentNumber || `WO-${r.Id}`} sub={fmtDate(r.DocumentDate)} /></td>
                  <td className={`${TD} max-w-[220px]`}><Two top={r.ProjectName} sub={r.CompanyName} /></td>
                  <td className={`${TD} max-w-[220px]`}><Two top={r.ContractorName || r.SupplierName} sub={r.BoqDocNo ? `BOQ ${r.BoqDocNo}` : undefined} /></td>
                  <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{r.ActivityCount}</td>
                  <td className={`${TD} text-right font-semibold tabular-nums whitespace-nowrap ${counted(r.Status) ? "text-foreground" : "text-muted-foreground line-through"}`}>{fmt(r.TotalAmount)}</td>
                  <td className={TD}><Status status={r.Status} /></td>
                  <td className={TD}><Who by={r.CreatedBy} at={r.CreatedAt} /></td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-foreground/10">
                    <td colSpan={8} className="px-4 pb-3 pt-1">
                      <table className="w-full" style={{ border: "1px solid hsl(var(--foreground) / 0.25)" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
                            {["Group", "Activity", "UOM", "Qty / area", "Rate", "Amount"].map((h, i) => (
                              <th key={h} className={`${LBL} px-3 py-2 ${i > 2 ? "text-right" : "text-left"}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {r.activities.map((a) => (
                            <tr key={a.Id} className="border-b border-foreground/10 last:border-0 text-xs">
                              <td className="px-3 py-2 text-muted-foreground">{a.ActivityGroupName || "—"}</td>
                              <td className="px-3 py-2 text-foreground">{a.ActivityName || "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{a.UOMName || "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(a.Quantity)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{fmt(a.Rate)}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{fmt(a.Amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={FOOT_RULE}>
            <td />
            <td colSpan={3} className={`${TD} ${LBL}`}>
              {rows.length} work order{rows.length !== 1 ? "s" : ""} · {rows.reduce((s, r) => s + r.activities.length, 0)} activities
            </td>
            <td />
            <td className={`${TD} text-right font-bold tabular-nums text-foreground whitespace-nowrap`}>{fmt(liveTotal(rows, (r) => r.TotalAmount))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function WorkDoneTable({ rows }: { rows: WorkDoneRow[] }) {
  if (!rows.length) return <Empty label="No work done was recorded on this date." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px]">
        <thead>
          <tr style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.25)" }}>
            <th className={`${TH} text-left`}>Work done</th>
            <th className={`${TH} text-left`}>Company / project</th>
            <th className={`${TH} text-left`}>Contractor / work order</th>
            <th className={`${TH} text-left`}>Work</th>
            <th className={`${TH} text-right`}>Gross</th>
            <th className={`${TH} text-right`}>Certified</th>
            <th className={`${TH} text-left`}>Status</th>
            <th className={`${TH} text-left`}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ID} className="border-b border-foreground/10 hover:bg-primary/5">
              <td className={TD}>
                <Two mono top={r.DocNo || `WD-${r.ID}`} sub={r.PeriodFrom || r.PeriodTo ? `${fmtDate(r.PeriodFrom)} – ${fmtDate(r.PeriodTo)}` : fmtDate(r.DocDate)} />
              </td>
              <td className={`${TD} max-w-[200px]`}><Two top={r.ProjectName} sub={r.CompanyName} /></td>
              <td className={`${TD} max-w-[200px]`}><Two top={r.ContractorName || r.SupplierName} sub={r.WorkOrderNo || undefined} /></td>
              <td className={`${TD} max-w-[240px]`}>
                <Two
                  top={<span className="text-muted-foreground">{r.DescriptionOfWork || "—"}</span>}
                  sub={r.QuantityDone != null ? `${fmtNum(r.QuantityDone)} ${r.Unit || ""} × ${fmt(r.RatePerUnit)}` : undefined}
                />
              </td>
              <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                <Two top={fmt(r.GrossAmount)} sub={r.Deductions ? `less ${fmt(r.Deductions)}` : undefined} />
              </td>
              <td className={`${TD} text-right font-semibold tabular-nums whitespace-nowrap ${counted(r.Status) ? "text-foreground" : "text-muted-foreground line-through"}`}>{fmt(r.CertifiedAmount)}</td>
              <td className={TD}><Status status={r.Status} /></td>
              <td className={TD}><Who by={r.CreatedBy} at={r.CreatedAt} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={FOOT_RULE}>
            <td colSpan={4} className={`${TD} ${LBL}`}>{rows.length} entr{rows.length !== 1 ? "ies" : "y"}</td>
            <td className={`${TD} text-right font-bold tabular-nums whitespace-nowrap`}>{fmt(liveTotal(rows, (r) => r.GrossAmount))}</td>
            <td className={`${TD} text-right font-bold tabular-nums text-foreground whitespace-nowrap`}>{fmt(liveTotal(rows, (r) => r.CertifiedAmount))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
