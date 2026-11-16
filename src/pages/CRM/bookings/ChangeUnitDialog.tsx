// Change Unit: start moving the buyer from this booking's unit to another unit, in this project or another one. Built
// on the CRM's own look: the dark money band on top (the buyer, the money, the old and new price, the steps and the
// next step), then step 1, the units free to move to as an inventory board (by block and floor, each unit with its
// type, area, value and the difference against now), then step 2, review (old against new at the unit's rate, the
// parking and extra charges the application starts with, the money after the change, what happens on approval, the
// reason). "Continue in application" opens the buyer's application for the new unit in the normal application wizard,
// filled from the booking: the rate, plan, parking and extra charges are settled there like any sale, and submitting
// it sends the unit change for its one approval (Approval Setup: CRM Unit Change). On approval the old booking closes,
// a new booking opens on the new unit and every rupee received moves to it in full. The server prices, previews and
// checks every rule (crmBookings.js unitChangeContext, unit-change-units); nothing here decides a figure.
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowRightLeft, Building2, Check, CircleCheck, ClipboardList, PenLine, Repeat, ShieldCheck, Wallet } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { GridDialog, GridRelated, GridSearch, GridSegment, GRID_BTN, GRID_BTN_BRAND, GRID_INPUT, GRID_TH, GRID_TD } from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { BAND_DOT, BandNext, MoneyBand, StepBar, asName, type StepState } from "../payments/parts";
import { fmtShort } from "../payments/config";
import { API, fetchUnits } from "./config";

const rs = (n: number | null | undefined) => (n == null ? "—" : fmtRupees(Number(n)));
const sqft = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("en-IN")} sq ft`);
const dt = (v: any) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const join = (...xs: any[]) => xs.filter((x) => x != null && x !== "").join(" · ");
const ALL = "All";

/** The difference against now, as a small tag: green when it costs less, amber when more. */
function Delta({ d, size = "sm" }: { d: number | null; size?: "sm" | "md" }) {
  if (d == null) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(d) < 0.5) return <span className={cn("inline-flex rounded px-1.5 text-muted-foreground bg-muted", size === "md" ? "text-xs py-0.5" : "text-[0.6875rem]")}>Same price</span>;
  return (
    <span className={cn("inline-flex rounded px-1.5 font-semibold tabular-nums", size === "md" ? "text-xs py-0.5" : "text-[0.6875rem]",
      d < 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
      {d > 0 ? "+" : "−"}{fmtShort(Math.abs(d))}
    </span>
  );
}

export function ChangeUnitDialog({ booking, onClose }: { booking: any; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<"unit" | "review">("unit");
  const [projectId, setProjectId] = useState(String(booking.ProjectId ?? ""));
  const [blockFilter, setBlockFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [unitSearch, setUnitSearch] = useState("");
  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: freeData, isLoading: unitsLoading } = useQuery({
    queryKey: ["crm-unit-change-units", booking.Id, projectId], staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${booking.Id}/unit-change-units?projectId=${projectId}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not load the units");
      return d as { units: any[]; currentUnitValue: number | null };
    },
  });
  const { data: o, isFetching, error } = useQuery({
    queryKey: ["crm-unit-change-options", booking.Id, unitId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${booking.Id}/unit-change-options${unitId ? `?unitId=${unitId}` : ""}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not load the unit change details");
      return d;
    },
    placeholderData: (prev) => prev,
  });
  const cur = o?.current;
  const next = unitId && o?.next?.unitId === Number(unitId) ? o.next : null;
  // A unit change already open on this booking: a draft is continued in its application; one sent is with the approvers.
  const open = o?.open as { id: number; requestNo: string; status: string; applicationId: number } | null | undefined;
  const continueApp = () => { onClose(); navigate(`/crm/applications?edit=${open!.applicationId}&step=1`); };
  const money = o?.money;
  const travels = o?.travels;
  const projects = useMemo(() => {
    const m = new Map<string, string>();
    if (booking.ProjectId != null) m.set(String(booking.ProjectId), booking.ProjectName || `Project ${booking.ProjectId}`);
    (units as any[]).filter((u) => u.IsActive && u.ProjectId != null).forEach((u) => m.set(String(u.ProjectId), u.ProjectName || `Project ${u.ProjectId}`));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [units, booking.ProjectId, booking.ProjectName]);

  // The units free to move to in the chosen project (server: free, not land, with an area), with their rate and value.
  const free: any[] = freeData?.units ?? [];
  const nowValue = freeData?.currentUnitValue ?? null;
  const blocks = useMemo(() => [...new Set(free.map((u) => u.blockName).filter(Boolean))].sort(), [free]);
  const types = useMemo(() => {
    const m = new Map<string, number>();
    free.forEach((u) => { if (u.unitType) m.set(u.unitType, (m.get(u.unitType) || 0) + 1); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [free]);
  const shown = useMemo(() => {
    const t = unitSearch.trim().toLowerCase();
    return free.filter((u) => (!blockFilter || u.blockName === blockFilter) && (typeFilter === ALL || u.unitType === typeFilter)
      && (!t || [u.unitNo, u.blockName, u.unitType, String(u.floorNo ?? "")].some((x) => String(x || "").toLowerCase().includes(t))));
  }, [free, blockFilter, typeFilter, unitSearch]);
  // The board: block, then floor (top floor first), then the units on it.
  const board = useMemo(() => {
    const byBlock = new Map<string, Map<string, any[]>>();
    for (const u of shown) {
      const b = u.blockName || "—";
      const f = u.floorNo != null ? String(u.floorNo) : "—";
      if (!byBlock.has(b)) byBlock.set(b, new Map());
      const floors = byBlock.get(b)!;
      if (!floors.has(f)) floors.set(f, []);
      floors.get(f)!.push(u);
    }
    return [...byBlock].map(([block, floors]) => ({
      block, floors: [...floors].sort((a, b) => Number(b[0]) - Number(a[0])).map(([floor, list]) => ({ floor, list })),
    }));
  }, [shown]);
  const borrowsRate = free.some((u) => !u.ownRate);

  const items: any[] = o?.items ?? [];
  const received = Number(money?.Received || 0);
  const balance = next?.balance != null ? Number(next.balance) : null;
  const allBlockers: string[] = o?.blockers ?? [];
  const blockers = open ? [] : allBlockers.filter((b) => unitId || !/new unit|own unit|booking amount of plan|tag a company bank|no rate/i.test(b));
  const invoices: any[] = o?.invoices ?? [];
  const missing = open ? "" : !next ? "Pick the new unit from the board." : blockers.length ? blockers[0] : !reason.trim() ? "Enter the reason." : "";
  const canStart = !open && !missing && !isFetching && !saving;

  const pick = (u: any) => { if (String(u.id) !== unitId) setUnitId(String(u.id)); };
  // Starts the unit change (a draft) and opens its application in the application wizard.
  const start = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${booking.Id}/unit-change`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ TargetUnitId: Number(unitId), Reason: reason.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not start the unit change");
      toast.success(d.message);
      ["crm-bookings", "crm-unit-changes", "unit-master", "crm-unit-change-units", "crm-apps"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
      navigate(`/crm/applications?edit=${d.applicationId}&step=1`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  // Old against new, row by row (prices with GST from the server's quote).
  const diff = (a: any, b: any) => (a == null || b == null ? null : Number(b) - Number(a));
  const compare: { label: string; now: React.ReactNode; next: React.ReactNode; delta?: number | null; total?: boolean }[] = cur && next ? [
    { label: "Unit", now: join(cur.blockName && `Block ${cur.blockName}`, cur.unitNo), next: join(next.blockName && `Block ${next.blockName}`, next.unitNo) },
    { label: "Project", now: cur.projectName, next: next.projectName },
    { label: "Type · floor", now: cur.unitType || "—", next: join(next.unitType, next.floorNo != null ? `Floor ${next.floorNo}` : null) || "—" },
    { label: "Saleable area", now: sqft(cur.areaSqFt), next: sqft(next.areaSqFt) },
    { label: "Rate per sq ft", now: rs(cur.ratePerSqFt), next: rs(next.ratePerSqFt), delta: diff(cur.ratePerSqFt, next.ratePerSqFt) },
    { label: "Unit value", now: rs(cur.totalValue), next: rs(next.unitPrice), delta: diff(cur.totalValue, next.unitPrice) },
    { label: "Parking", now: rs(cur.parkingTotal), next: rs(next.parkingTotal), delta: diff(cur.parkingTotal, next.parkingTotal) },
    { label: "Extra charges", now: rs(cur.extraChargesTotal), next: rs(next.extraChargesTotal), delta: diff(cur.extraChargesTotal, next.extraChargesTotal) },
    { label: "GST", now: rs(cur.gstAmount), next: rs(next.gstAmount), delta: diff(cur.gstAmount, next.gstAmount) },
    { label: "Price (incl. GST)", now: rs(cur.grandTotal), next: rs(next.grandTotal), delta: diff(cur.grandTotal, next.grandTotal), total: true },
  ] : [];
  const onApproval = [
    `${cur?.bookingNo || booking.BookingNo} closes as Unit Changed; its unit goes back on sale.`,
    `A new booking opens on ${next ? join(next.projectName, next.blockName && `Block ${next.blockName}`, next.unitNo) : "the new unit"} for the same buyer, already confirmed.`,
    `${rs(received)} received moves to it in full; there is no separate unit-change fee${next?.isCrossCompany ? ", and the cross-company Fund Transfer needs Finance approval" : ""}.`,
    Number(money?.WithFinance) > 0 ? `${rs(money.WithFinance)} with Finance follows once verified.` : null,
    invoices.length ? `${invoices.map((i) => i.invoiceNo).join(", ")} ${invoices.length > 1 ? "are" : "is"} cancelled with a credit note.` : null,
    travels && (travels.CoApplicants || travels.Documents || travels.BankDetails || travels.LoanBank)
      ? `${[travels.CoApplicants ? "Co-applicants" : null, travels.Documents ? "KYC documents" : null, travels.BankDetails ? "bank details" : null, travels.LoanBank ? "home loan" : null].filter(Boolean).join(", ")} come across.` : null,
    travels?.BrokerName ? `Brokerage of ${travels.BrokerName} moves as it stands${Number(travels.BrokeragePaid) > 0 ? "; what is paid stays paid" : ""}.` : null,
  ].filter(Boolean) as string[];

  const steps: { label: string; state: StepState }[] = open ? [
    { label: "New unit", state: "done" },
    { label: "Application", state: open.status === "Draft" ? "active" : "done" },
    { label: "Approval", state: open.status === "Draft" ? "off" : "active" },
  ] : [
    { label: "New unit", state: next ? "done" : "active" },
    { label: "Application", state: "off" },
    { label: "Approval", state: "off" },
  ];
  const creditSide = balance != null && balance < 0;

  return (
    <GridDialog onClose={onClose} icon={Repeat} width="max-w-6xl sm:w-[calc(100vw-3rem)]" title="Change Unit"
      description={`${booking.BookingNo} · move the buyer to another unit, here or in another project`}
      footer={<>
        <span className={cn("mr-auto self-center text-xs", missing ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400 font-medium")}>
          {open ? "" : missing || "Next: the application for the new unit, to settle rate, plan, parking and charges, then send it for approval."}
        </span>
        <button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button>
        {open ? (
          open.status === "Draft"
            ? <button type="button" onClick={continueApp} className={GRID_BTN_BRAND}>Continue in application <ArrowRight size={13} /></button>
            : <button type="button" onClick={() => { onClose(); navigate(`/crm/unit-changes?id=${open.id}`); }} className={GRID_BTN_BRAND}>Open {open.requestNo} <ArrowRight size={13} /></button>
        ) : step === "unit" ? (
          <button type="button" onClick={() => setStep("review")} disabled={!next || isFetching} className={GRID_BTN_BRAND}>Review <ArrowRight size={13} /></button>
        ) : <>
          <button type="button" onClick={() => setStep("unit")} className={GRID_BTN}><ArrowLeft size={13} /> Change the unit</button>
          <button type="button" onClick={start} disabled={!canStart} className={GRID_BTN_BRAND}>{saving ? "Starting…" : "Continue in application"} <ArrowRight size={13} /></button>
        </>}
      </>}>
      <div className="space-y-4">
        <MoneyBand eyebrow={`${cur?.bookingNo || booking.BookingNo} · booked ${dt(cur?.bookingDate)}`}
          title={<span className="capitalize">{asName(cur?.customerName || booking.ApplicantName)}</span>}
          status={cur?.status ? <span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{cur.status}</span> : undefined}
          sub={cur ? join(cur.projectName, cur.blockName && `Block ${cur.blockName}`, cur.unitNo, cur.unitType, sqft(cur.areaSqFt)) : "Loading…"}
          lead={fmtShort(received)} leadNote="Received · moves in full"
          bar={<StepBar steps={steps} onDark />}
          figures={[
            { label: "Price now", value: fmtShort(Number(cur?.grandTotal || 0)), exact: rs(cur?.grandTotal), note: `incl. GST · ${rs(cur?.ratePerSqFt)}/sq ft` },
            { label: "New price", dot: BAND_DOT.collected, value: next ? fmtShort(Number(next.grandTotal || 0)) : "—", exact: next ? rs(next.grandTotal) : undefined,
              note: next ? join(next.blockName && `Block ${next.blockName}`, next.unitNo) : "pick a unit" },
            { label: creditSide ? "Buyer's credit" : "Left to pay", dot: creditSide ? BAND_DOT.collected : BAND_DOT.finance,
              value: balance != null ? fmtShort(Math.abs(balance)) : "—", exact: balance != null ? rs(Math.abs(balance)) : undefined,
              note: balance == null ? "after the change" : creditSide ? "stays on account" : balance === 0 ? "fully paid" : "on the new booking" },
            { label: "With Finance", value: fmtShort(Number(money?.WithFinance || 0)), exact: rs(money?.WithFinance),
              note: Number(money?.NotSentToFinance) > 0 ? `${fmtShort(Number(money.NotSentToFinance))} not sent yet` : "follows once verified" },
          ]}
          footer={<BandNext text={error ? translateError((error as Error).message)
            : open ? (open.status === "Draft" ? `Unit change ${open.requestNo} is started: finish its application and submit it for approval.` : `Unit change ${open.requestNo} is ${open.status}.`)
            : missing || "Continue in the application."} finished={!missing && !open} />} />

        {blockers.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="space-y-1">{blockers.map((b) => <p key={b}>{b}</p>)}</div>
          </div>
        )}

        {open ? (
          <GridRelated icon={ClipboardList} title={`Unit change ${open.requestNo}`}>
            <p className="px-4 py-4 text-[0.8125rem]">
              {open.status === "Draft"
                ? "This unit change is started. Its application is where you agree the new unit's rate and set the payment plan, parking and extra charges. The unit rate is prefilled and can be changed. Submitting the application sends the unit change for approval. To pick another unit, withdraw it on the Unit Changes page and start again."
                : `This unit change is ${open.status}: it is with the approvers. Nothing else can be started on this booking until it ends.`}
            </p>
          </GridRelated>
        ) : step === "unit" ? (
          <GridRelated icon={Building2} title="Choose the new unit" count={shown.length}
            action={<span className="text-xs text-muted-foreground">{free.length} free in this project</span>}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
              <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setUnitId(""); setBlockFilter(""); setTypeFilter(ALL); }}
                className={cn(GRID_INPUT, "w-auto min-w-[14rem]")} aria-label="Project">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === String(booking.ProjectId ?? "") ? " (this project)" : ""}</option>)}
              </select>
              <select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)} className={cn(GRID_INPUT, "w-auto min-w-[9rem]")} aria-label="Block">
                <option value="">All blocks</option>
                {blocks.map((b) => <option key={b} value={b}>Block {b}</option>)}
              </select>
              {types.length > 1 && (
                <GridSegment label="Unit type" value={typeFilter} onChange={setTypeFilter}
                  options={[{ key: ALL, label: "All", count: free.length }, ...types.map(([t, n]) => ({ key: t, label: t, count: n }))]} />
              )}
              <div className="ml-auto w-full sm:w-56 min-w-0 [&>*]:w-full"><GridSearch value={unitSearch} onChange={setUnitSearch} placeholder="Search unit or floor" /></div>
            </div>
            <div className="max-h-[max(16rem,calc(100vh-34rem))] overflow-auto px-4 py-3 space-y-5">
              {unitsLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading units…</p>
                : board.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No free unit matches. Try another block, type or project.</p>
                : board.map(({ block, floors }) => (
                  <section key={block} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Block {block}</h4>
                    {floors.map(({ floor, list }) => (
                      <div key={floor} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 items-start">
                        <div className="pt-2.5 text-xs font-medium text-muted-foreground tabular-nums">Floor {floor}</div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2">
                          {list.map((u) => {
                            const on = String(u.id) === unitId;
                            const d = u.unitValue != null && nowValue != null ? Number(u.unitValue) - Number(nowValue) : null;
                            return (
                              <button key={u.id} type="button" onClick={() => pick(u)} onDoubleClick={() => { pick(u); setStep("review"); }} aria-pressed={on}
                                className={cn("relative text-left rounded-lg border bg-card px-3 py-2.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                                  on ? "border-primary ring-2 ring-primary/25 bg-primary/[0.04] shadow-sm" : "border-border hover:border-primary/50 hover:shadow-sm")}>
                                {on && <span className="absolute top-2 right-2 inline-flex w-5 h-5 rounded-full bg-primary text-primary-foreground items-center justify-center"><Check size={12} strokeWidth={3} /></span>}
                                <div className="flex items-baseline gap-2 pr-6">
                                  <span className="text-[0.8125rem] font-semibold truncate">{u.unitNo}</span>
                                  {u.unitType && <span className="text-[0.6875rem] text-muted-foreground whitespace-nowrap">{u.unitType}</span>}
                                </div>
                                <div className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
                                  {sqft(u.areaSqFt)} · {rs(u.ratePerSqFt)}{!u.ownRate && "*"}
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold tabular-nums">{u.unitValue != null ? fmtShort(Number(u.unitValue)) : "—"}</span>
                                  <Delta d={d} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </section>
                ))}
            </div>
            <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
              Value is area × rate, before parking, charges and GST; the review prices it in full. The tag shows the difference against the current unit's value ({rs(nowValue)}).
              {borrowsRate ? ` * No rate of its own: this booking's rate (${rs(cur?.ratePerSqFt)} per sq ft) is used; it can be changed in the application.` : ""}
              {" "}Double-click a unit to go straight to the review.
            </p>
          </GridRelated>
        ) : next && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 items-start">
            <div className="space-y-4 min-w-0">
              <GridRelated icon={ArrowRightLeft} title="Old and new"
                action={<span className="text-xs text-muted-foreground">{next.isCrossCompany ? "Another company · money moves by Fund Transfer" : next.isCrossProject ? "Another project" : "Same project"}</span>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem] border-separate border-spacing-0">
                    <thead><tr>
                      <th className={cn(GRID_TH, "text-left")} aria-label="Item" />
                      {["Now", "New", "Difference"].map((h) => <th key={h} className={cn(GRID_TH, "text-right")}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {compare.map((row) => (
                        <tr key={row.label} className={row.total ? "bg-muted/60" : undefined}>
                          <td className={cn(GRID_TD, "whitespace-nowrap", row.total ? "font-semibold" : "text-muted-foreground")}>{row.label}</td>
                          <td className={cn(GRID_TD, "text-right tabular-nums whitespace-nowrap", row.total && "font-semibold")}>{row.now}</td>
                          <td className={cn(GRID_TD, "text-right tabular-nums whitespace-nowrap", row.total && "font-semibold")}>{row.next}</td>
                          <td className={cn(GRID_TD, "text-right whitespace-nowrap")}>{row.delta === undefined ? null : <Delta d={row.delta} size="md" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
                  {next.unitRate == null ? "This unit has no rate of its own: the booking's rate is used. " : ""}
                  Priced at the unit's current rate, using the unit's GST rule. The application opens with that rate filled in so you can agree the final rate, payment plan, parking and extra charges before sending the change for approval.
                </p>
              </GridRelated>

              <GridRelated icon={Wallet} title="Parking and extra charges" count={items.length}
                action={<span className="text-xs text-muted-foreground">The application starts with these; change them there</span>}>
                <div className="divide-y divide-border">
                  {items.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">The booking has no parking or extra charges. Add any in the application.</p>}
                  {items.map((a, i) => (
                    <div key={`${a.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-[0.8125rem] font-medium">{a.kind === "Parking" ? "Parking" : "Extra charge"} · {a.label}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">{rs(a.amount)} before GST</div>
                      </div>
                      <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                        a.change === "kept" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                        {a.change === "kept" ? "Comes across" : "Stays behind: in the old project"}
                      </span>
                    </div>
                  ))}
                </div>
              </GridRelated>
            </div>

            <div className="space-y-4 min-w-0 xl:sticky xl:top-0">
              <GridRelated icon={Wallet} title="Money after the change">
                <dl className="px-4 py-3 space-y-2.5 text-[0.8125rem]">
                  <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Received, moves in full</dt><dd className="tabular-nums font-semibold">{rs(received)}</dd></div>
                  <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">New price (incl. GST)</dt><dd className="tabular-nums font-semibold">{rs(next.grandTotal)}</dd></div>
                  {Number(money?.WithFinance) > 0 && <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">With Finance, follows once verified</dt><dd className="tabular-nums">{rs(money.WithFinance)}</dd></div>}
                  <div className={cn("flex items-baseline justify-between gap-3 rounded-md px-3 py-2.5 -mx-1",
                    creditSide || balance === 0 ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-300")}>
                    <dt className="font-medium">{creditSide ? "Extra, stays as the buyer's credit" : balance === 0 ? "Nothing left to pay" : "Left to pay on the new booking"}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{balance != null ? rs(Math.abs(balance)) : "—"}</dd>
                  </div>
                </dl>
              </GridRelated>

              <GridRelated icon={ShieldCheck} title="On approval">
                <ul className="px-4 py-3 space-y-2 text-[0.8125rem]">
                  {onApproval.map((t) => <li key={t} className="flex gap-2"><CircleCheck size={14} className="mt-0.5 shrink-0 text-primary" /><span>{t}</span></li>)}
                </ul>
                {invoices.length > 0 && (
                  <div className="border-t border-border divide-y divide-border">
                    {invoices.map((i) => (
                      <div key={i.invoiceNo} className="flex items-center justify-between gap-3 px-4 py-2 text-[0.8125rem]">
                        <span className="min-w-0"><span className="font-medium tabular-nums">{i.invoiceNo}</span> <span className="text-muted-foreground">· {i.type} · {dt(i.invoiceDate)}</span>
                          {i.timeBarred && <span className="block text-xs text-destructive">Past the credit note deadline ({i.deadline})</span>}</span>
                        <span className="tabular-nums whitespace-nowrap">{rs(i.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </GridRelated>

              <GridRelated icon={PenLine} title="Reason">
                <div className="p-3">
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Why the buyer is changing the unit" aria-label="Reason"
                    className={cn(GRID_INPUT, "h-auto py-2 resize-none w-full")} />
                </div>
              </GridRelated>
            </div>
          </div>
        )}
      </div>
    </GridDialog>
  );
}
