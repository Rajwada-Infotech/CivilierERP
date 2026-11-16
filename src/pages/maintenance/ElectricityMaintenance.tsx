import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Zap, Gauge, Users, Clock3, Receipt, Wallet, Plus, Search, FileText,
  CheckCircle2, Ban, Loader2, History as HistoryIcon, BarChart3, ShieldAlert,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SheetTabs, TD, TH } from "@/components/maintenance/maintParts";
import { HrStatStrip, HR_FIELD, HR_HEAD, HR_LBL } from "@/components/hrpayroll/HrUi";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE, KEY_RED_SOLID } from "@/components/sheet/sheetParts";
import { usePageRights } from "@/hooks/usePageRights";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportMenu } from "@/components/ExportMenu";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import {
  getMeters, getElectricityDashboard, getElectricityProviders, getNextReadingInfo, recordReading,
  getMeterReadings, correctReading, previewBill, generateBill, getElectricityBills, verifyBill,
  addBillToCustomerBill, cancelBill, getMonthlyReport, getProviderWiseReport, getCustomerWiseReport, getElectricityAuditLog,
  type MeterRow, type ElectricityBillRow, type BillPreview, type MeterReadingRow, type BillStatus,
} from "@/api/electricityMaintenanceApi";
import { DateInput } from "@/components/ui/date-input";

const PAGE_KEY = "maintenance-electricity";
const TABS = ["overview", "meters", "bills", "reports", "audit"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", meters: "Meters & Readings", bills: "Billing", reports: "Reports", audit: "Audit Log" };

const inputCls = `${HR_FIELD} w-auto`;
const labelCls = `block mb-1.5 ${HR_LBL}`;
const fieldCls = HR_FIELD;
const fmt = (n: number | null | undefined) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN") : "—");

// Status as sheet marks: solid = settled, hatched = waiting, half = under way, red = stopped, empty = not started.
const BILL_STATUS_TONE: Record<BillStatus, MarkTone> = {
  PendingVerification: "waiting", Verified: "moving", AddedToCustomerBill: "done", Cancelled: "stopped", Revised: "draft",
};
const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  PendingVerification: "Pending Verification", Verified: "Verified", AddedToCustomerBill: "Added to Bill", Cancelled: "Cancelled", Revised: "Revised",
};
function BillStatusBadge({ status }: { status: BillStatus }) {
  return <SheetMark text={BILL_STATUS_LABEL[status] ?? status} tone={BILL_STATUS_TONE[status] ?? "draft"} />;
}
function HandoverBadge({ status }: { status: string }) {
  const tone: MarkTone = status === "Handover Completed" ? "done" : status === "Handover Scheduled" ? "waiting" : "draft";
  return <SheetMark text={status} tone={tone} />;
}

export default function ElectricityMaintenance() {
  const rights = usePageRights(PAGE_KEY);
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Electricity Maintenance"]} />
      <MaintenanceShell title="Electricity Maintenance" subtitle="Meter readings, tariff-based billing and the Rajwada/handover split">
        <SheetTabs<Tab> tabs={TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))} value={tab} onChange={setTab} />

        {tab === "overview" && <OverviewTab />}
        {tab === "meters" && <MetersTab rights={rights} />}
        {tab === "bills" && <BillsTab rights={rights} />}
        {tab === "reports" && <ReportsTab rights={rights} />}
        {tab === "audit" && <AuditTab />}
      </MaintenanceShell>
    </>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────
function OverviewTab() {
  const { data, isLoading } = useQuery({ queryKey: ["electricity-dashboard"], queryFn: getElectricityDashboard, refetchInterval: 60_000 });
  return (
    <HrStatStrip items={[
      { label: "Total Meters", value: isLoading ? "…" : data?.totalMeters ?? 0 },
      { label: "Reading Pending", value: isLoading ? "…" : data?.readingPending ?? 0, tone: (data?.readingPending ?? 0) > 0 ? "hsl(var(--destructive))" : undefined },
      { label: "Bills Generated", value: isLoading ? "…" : data?.billsGenerated ?? 0 },
      { label: "Current Amount", value: isLoading ? "…" : fmt(data?.currentAmount) },
    ]} />
  );
}

// ─── Meters & Readings ───────────────────────────────────────────────────
function MetersTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const [search, setSearch] = useState("");
  const [providerId, setProviderId] = useState("");
  const [billingCycle, setBillingCycle] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [tower, setTower] = useState("");
  const [handoverStatus, setHandoverStatus] = useState("");
  const [readingFor, setReadingFor] = useState<MeterRow | null>(null);
  const [billingFor, setBillingFor] = useState<MeterRow | null>(null);
  const [historyFor, setHistoryFor] = useState<MeterRow | null>(null);
  const [auditFor, setAuditFor] = useState<MeterRow | null>(null);

  const { data: providers } = useQuery({ queryKey: ["electricity-providers"], queryFn: getElectricityProviders });
  const filters = useMemo(
    () => ({
      search, providerId: providerId || undefined, billingCycle: billingCycle || undefined, status: status || undefined,
      project: project || undefined, tower: tower || undefined, handoverStatus: handoverStatus || undefined,
    }),
    [search, providerId, billingCycle, status, project, tower, handoverStatus],
  );
  const { data, isLoading, error } = useQuery({ queryKey: ["electricity-meters", filters], queryFn: () => getMeters(filters) });
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, flat, meter, box…" className={`pl-8 pr-3 w-56 ${inputCls}`} />
        </div>
        <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project" className={`w-32 ${inputCls}`} />
        <input value={tower} onChange={(e) => setTower(e.target.value)} placeholder="Tower" className={`w-28 ${inputCls}`} />
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputCls}>
          <option value="">All Providers</option>
          {(providers || []).map((p) => (<option key={p.Id} value={p.Id}>{p.Name}</option>))}
        </select>
        <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} className={inputCls}>
          <option value="">All Cycles</option>
          <option value="Monthly">Monthly</option>
          <option value="3 Monthly">3 Monthly</option>
        </select>
        <select value={handoverStatus} onChange={(e) => setHandoverStatus(e.target.value)} className={inputCls}>
          <option value="">All Handover Status</option>
          {["Not Handed Over", "Handover Scheduled", "Handover Completed"].map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="">All Status</option>
          {["Active", "Inactive", "Transferred", "Disconnected"].map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        {rights.canExport && (
          <div className="ml-auto">
            <ExportMenu
              data={rows as unknown as Record<string, unknown>[]}
              title="Electricity Meters"
              filename="electricity-meters"
              columns={[
                { header: "Customer", accessor: "CustomerName" },
                { header: "Flat", accessor: (r) => [r.BlockName, r.UnitNo].filter(Boolean).join(" / ") },
                { header: "Meter Box", accessor: "MeterBoxNumber" },
                { header: "Meter No.", accessor: "MeterNumber" },
                { header: "Provider", accessor: "ProviderName" },
                { header: "Billing Cycle", accessor: "BillingCycle" },
                { header: "Previous", accessor: "LatestPreviousReading" },
                { header: "Current", accessor: "LatestCurrentReading" },
                { header: "Units", accessor: "LatestUnitsConsumed" },
                { header: "Handover Status", accessor: "HandoverStatus" },
                { header: "Bill Status", accessor: "LatestBillStatus" },
                { header: "Status", accessor: "Status" },
              ]}
            />
          </div>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">Failed to load meters.</div>}
      {!isLoading && !error && rows.length === 0 && (
        <div className="bg-card border border-dashed border-foreground/40 py-10 text-center text-sm text-muted-foreground">
          No meters match these filters. Add meters via Maintenance Setup → Meter Reading Master.
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-card border border-foreground overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Customer</th>
                <th className={TH}>Flat</th>
                <th className={TH}>Meter Box</th>
                <th className={TH}>Meter No.</th>
                <th className={TH}>Provider</th>
                <th className={TH}>Previous</th>
                <th className={TH}>Current</th>
                <th className={TH}>Units</th>
                <th className={TH}>Handover</th>
                <th className={TH}>Bill Status</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.Id} className="hover:bg-primary/5">
                  <td className={`${TD} font-medium text-foreground`}>{m.CustomerName}</td>
                  <td className={TD}>{[m.BlockName, m.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                  <td className={`${TD} font-heading tabular-nums text-xs`}>{m.MeterBoxNumber || "—"}</td>
                  <td className={`${TD} font-heading tabular-nums text-xs`}>{m.MeterNumber}</td>
                  <td className={`${TD} text-muted-foreground`}>{m.ProviderName}</td>
                  <td className={`${TD} font-heading tabular-nums text-xs`}>{m.LatestPreviousReading ?? "—"}</td>
                  <td className={`${TD} font-heading tabular-nums text-xs`}>{m.LatestCurrentReading ?? "—"}</td>
                  <td className={TD}>{m.LatestUnitsConsumed ?? "—"}</td>
                  <td className={TD}><HandoverBadge status={m.HandoverStatus} /></td>
                  <td className={TD}>{m.LatestBillStatus ? <BillStatusBadge status={m.LatestBillStatus} /> : <span className="text-muted-foreground text-xs">Pending</span>}</td>
                  <td className={TD}>
                    <SheetMark text={m.Status} tone={m.Status === "Active" ? "done" : m.Status === "Disconnected" ? "stopped" : "draft"} />
                  </td>
                  <td className={TD}>
                    <div className="flex items-center justify-end gap-1.5">
                      {rights.canCreate && m.Status === "Active" && (
                        <button onClick={() => setReadingFor(m)} className={`${KEY_INK} h-8 px-3`}>
                          <Plus size={12} /> Reading
                        </button>
                      )}
                      {rights.canCreate && m.Status === "Active" && (
                        <button onClick={() => setBillingFor(m)} className={`${KEY_LINE} h-8 px-3`}>
                          <FileText size={12} /> Generate Bill
                        </button>
                      )}
                      <button onClick={() => setHistoryFor(m)} title="View History" className={ICON_ACT}>
                        <HistoryIcon size={14} />
                      </button>
                      <button onClick={() => setAuditFor(m)} title="View Audit Log" className={ICON_ACT}>
                        <ShieldAlert size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {readingFor && <AddReadingDialog meter={readingFor} onClose={() => setReadingFor(null)} />}
      {billingFor && <GenerateBillDialog meter={billingFor} onClose={() => setBillingFor(null)} />}
      {historyFor && <MeterHistoryDialog meter={historyFor} onClose={() => setHistoryFor(null)} />}
      {auditFor && <AuditLogModal title={`Audit Log — ${auditFor.MeterNumber}`} filters={{ meterId: auditFor.Id }} onClose={() => setAuditFor(null)} />}
    </div>
  );
}

function AddReadingDialog({ meter, onClose }: { meter: MeterRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [readingType, setReadingType] = useState<"Regular" | "Handover">("Regular");
  const [currentReading, setCurrentReading] = useState("");
  const [readingDate, setReadingDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const { data: info, isLoading } = useQuery({ queryKey: ["next-reading-info", meter.Id], queryFn: () => getNextReadingInfo(meter.Id) });

  const handleSubmit = async () => {
    if (!currentReading || Number.isNaN(Number(currentReading))) { toast.error("Current Reading is required"); return; }
    setSaving(true);
    try {
      const res = await recordReading(meter.Id, { currentReading: Number(currentReading), readingDate, readingType });
      toast.success(`Reading recorded — ${res.unitsConsumed} units consumed`);
      queryClient.invalidateQueries({ queryKey: ["electricity-meters"] });
      queryClient.invalidateQueries({ queryKey: ["electricity-dashboard"] });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Failed to record reading");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-sm" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Add Meter Reading</DialogTitle></DialogHeader>
        {isLoading || !info ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2 text-xs border border-foreground/20 bg-foreground/5 p-2.5">
              <div><p className="text-muted-foreground">Customer</p><p className="font-medium text-foreground">{meter.CustomerName}</p></div>
              <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{[meter.BlockName, meter.UnitNo].filter(Boolean).join(" / ") || "—"}</p></div>
              <div><p className="text-muted-foreground">Meter Box</p><p className="font-medium text-foreground">{meter.MeterBoxNumber || "—"}</p></div>
              <div><p className="text-muted-foreground">Meter No.</p><p className="font-heading tabular-nums font-medium text-foreground">{meter.MeterNumber}</p></div>
              <div><p className="text-muted-foreground">Provider</p><p className="font-medium text-foreground">{meter.ProviderName}</p></div>
              <div><p className="text-muted-foreground">Billing Period</p><p className="font-medium text-foreground">{fmtDate(info.periodFrom)} → {fmtDate(info.periodTo)}</p></div>
            </div>

            {info.handoverStatus === "Handover Completed" && (
              <div>
                <label className={labelCls}>Reading Type</label>
                <select value={readingType} onChange={(e) => setReadingType(e.target.value as "Regular" | "Handover")} className={fieldCls}>
                  <option value="Regular">Regular (period-end)</option>
                  <option value="Handover">Handover (as of {fmtDate(info.handoverDate)})</option>
                </select>
              </div>
            )}

            <div>
              <label className={labelCls}>Previous Reading</label>
              <input value={info.previousReading} disabled className={`${fieldCls} disabled:opacity-70 font-heading tabular-nums`} />
            </div>
            <div>
              <label className={labelCls}>Current Reading</label>
              <input type="number" value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} className={fieldCls} autoFocus />
            </div>
            <div>
              <label className={labelCls}>Reading Date</label>
              <DateInput value={readingDate} onChange={(e) => setReadingDate(e.target.value)} className={fieldCls} />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
              <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save Reading
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GenerateBillDialog({ meter, onClose }: { meter: MeterRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const p = await previewBill(meter.Id, periodFrom, periodTo);
      setPreview(p);
    } catch (err: any) {
      setPreviewError(err?.message || "Failed to preview bill");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateBill({ meterId: meter.Id, periodFrom, periodTo });
      toast.success("Electricity bill generated");
      queryClient.invalidateQueries({ queryKey: ["electricity-bills"] });
      queryClient.invalidateQueries({ queryKey: ["electricity-dashboard"] });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate bill");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-md max-h-[88vh] overflow-y-auto" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Generate Electricity Bill</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Period From</label><DateInput value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className={fieldCls} /></div>
            <div><label className={labelCls}>Period To</label><DateInput value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className={fieldCls} /></div>
          </div>
          <button onClick={loadPreview} disabled={loadingPreview} className={`${KEY_LINE} h-9 px-3`}>
            {loadingPreview ? <Loader2 size={13} className="animate-spin" /> : null} Preview
          </button>

          {previewError && (
            <div className="border border-destructive bg-destructive/10 px-3 py-2.5 text-xs text-destructive flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" /> {previewError}
            </div>
          )}

          {preview && (
            <div className="border border-foreground/20 p-3 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-muted-foreground">Customer</p><p className="font-medium text-foreground">{preview.customerName}</p></div>
                <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{[preview.blockName, preview.unitNo].filter(Boolean).join(" / ") || "—"}</p></div>
                <div><p className="text-muted-foreground">Meter</p><p className="font-heading tabular-nums font-medium text-foreground">{preview.meterNumber}</p></div>
                <div><p className="text-muted-foreground">Provider</p><p className="font-medium text-foreground">{preview.providerName}</p></div>
              </div>
              <div className="border-t border-foreground/15 pt-2 grid grid-cols-2 gap-2">
                <div><p className="text-muted-foreground">Previous Reading</p><p className="font-heading tabular-nums font-medium text-foreground">{preview.previousReading}</p></div>
                <div><p className="text-muted-foreground">Current Reading</p><p className="font-heading tabular-nums font-medium text-foreground">{preview.currentReading}</p></div>
                <div><p className="text-muted-foreground">Consumption</p><p className="font-medium text-foreground">{preview.totalUnits} Units</p></div>
                <div><p className="text-muted-foreground">Handover Status</p><HandoverBadge status={preview.handoverStatus} /></div>
              </div>
              {preview.handoverDate && (
                <div className="border-t border-foreground/15 pt-2 grid grid-cols-2 gap-2">
                  <div><p className="text-muted-foreground">Handover Date</p><p className="font-medium text-foreground">{fmtDate(preview.handoverDate)}</p></div>
                  <div><p className="text-muted-foreground">Handover Reading</p><p className="font-heading tabular-nums font-medium text-foreground">{preview.handoverReading ?? "—"}</p></div>
                  <div><p className="text-muted-foreground">Rajwada Consumption</p><p className="font-semibold text-foreground">{preview.rajwadaUnits} Units</p></div>
                  <div><p className="text-muted-foreground">Post-Handover</p><p className="font-medium text-foreground">{preview.postHandoverUnits} Units</p></div>
                </div>
              )}
              <div className="border-t border-foreground/15 pt-2 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Energy Charge</span><span className="font-heading tabular-nums">{fmt(preview.energyCharge)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fixed Charge</span><span className="font-heading tabular-nums">{fmt(preview.fixedCharge)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Other Charge</span><span className="font-heading tabular-nums">{fmt(preview.otherCharge)}</span></div>
                <div className="flex justify-between font-heading font-bold text-foreground border-t border-foreground/15 pt-1"><span>Electricity Amount</span><span className="font-heading tabular-nums">{fmt(preview.totalAmount)}</span></div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
            <button onClick={handleGenerate} disabled={!preview || generating} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              {generating ? <Loader2 size={13} className="animate-spin" /> : null} Generate Bill
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MeterHistoryDialog({ meter, onClose }: { meter: MeterRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState<MeterReadingRow | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["meter-readings", meter.Id], queryFn: () => getMeterReadings(meter.Id) });
  const { data: bills } = useQuery({ queryKey: ["electricity-bills", { meterId: meter.Id }], queryFn: () => getElectricityBills({ meterId: meter.Id }) });
  const rows = Array.isArray(data) ? data : [];
  const billRows = Array.isArray(bills) ? bills : [];

  // A reading "closes" whichever non-cancelled bill's period ends on the
  // same date — matches spec §28's history table, which shows the bill
  // amount alongside the reading that generated it.
  const billForReading = (r: MeterReadingRow) => {
    if (r.ReadingType !== "Regular") return null;
    const readingEnd = r.BillingPeriodTo?.slice(0, 10);
    return billRows.find((b) => b.BillingPeriodTo?.slice(0, 10) === readingEnd && b.BillStatus !== "Cancelled") || null;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-2xl max-h-[85vh] overflow-y-auto" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Reading History — {meter.MeterNumber}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No readings recorded yet.</div>
        ) : (
          <div className="bg-card border border-foreground overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className={TH}>Date</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Previous</th>
                  <th className={TH}>Current</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>Bill</th>
                  <th className={TH}>Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bill = billForReading(r);
                  return (
                  <tr key={r.Id} className={`border-t border-foreground/10 ${r.IsSuperseded ? "opacity-50" : ""}`}>
                    <td className="px-2 py-1.5">{fmtDate(r.ReadingDate)}</td>
                    <td className="px-2 py-1.5">{r.ReadingType}</td>
                    <td className="px-2 py-1.5 font-heading tabular-nums">{r.PreviousReading}</td>
                    <td className="px-2 py-1.5 font-heading tabular-nums">{r.CurrentReading}</td>
                    <td className="px-2 py-1.5">{r.UnitsConsumed}</td>
                    <td className="px-2 py-1.5 font-heading tabular-nums">{bill ? fmt(bill.TotalAmount) : "—"}</td>
                    <td className="px-2 py-1.5">{r.IsSuperseded ? "Superseded" : "Active"}</td>
                    <td className="px-1 py-1.5 text-center">
                      {!r.IsSuperseded && (
                        <button onClick={() => setCorrecting(r)} title="Correct" className={ICON_ACT}>
                          <Receipt size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
      {correcting && (
        <CorrectReadingDialog
          reading={correcting}
          onClose={() => setCorrecting(null)}
          onDone={() => { setCorrecting(null); queryClient.invalidateQueries({ queryKey: ["meter-readings", meter.Id] }); }}
        />
      )}
    </Dialog>
  );
}

function CorrectReadingDialog({ reading, onClose, onDone }: { reading: MeterReadingRow; onClose: () => void; onDone: () => void }) {
  const [correctedCurrentReading, setCorrectedCurrentReading] = useState(String(reading.CurrentReading));
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim() || !approvedBy.trim()) { toast.error("Reason and Approved By are required"); return; }
    setSaving(true);
    try {
      await correctReading(reading.Id, { correctedCurrentReading: Number(correctedCurrentReading), reason: reason.trim(), approvedBy: approvedBy.trim() });
      toast.success("Reading corrected");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Failed to correct reading");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-sm" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Correct Reading</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">Original current reading: <span className="font-heading tabular-nums text-foreground">{reading.CurrentReading}</span>. The original is kept in history, never deleted.</p>
          <div><label className={labelCls}>Corrected Current Reading</label><input type="number" value={correctedCurrentReading} onChange={(e) => setCorrectedCurrentReading(e.target.value)} className={fieldCls} /></div>
          <div><label className={labelCls}>Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={`${HR_FIELD} h-auto py-2 resize-none`} /></div>
          <div><label className={labelCls}>Approved By</label><input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={fieldCls} /></div>
          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save Correction
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Billing (history + verify/add-to-customer-bill/cancel) ─────────────
function BillsTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const queryClient = useQueryClient();
  const [billStatus, setBillStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [addingTo, setAddingTo] = useState<ElectricityBillRow | null>(null);
  const [cancelling, setCancelling] = useState<ElectricityBillRow | null>(null);
  const [auditFor, setAuditFor] = useState<ElectricityBillRow | null>(null);

  const filters = useMemo(() => ({ billStatus: billStatus || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }), [billStatus, dateFrom, dateTo]);
  const { data, isLoading, error } = useQuery({ queryKey: ["electricity-bills", filters], queryFn: () => getElectricityBills(filters) });
  const rows = Array.isArray(data) ? data : [];

  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["electricity-bills"] }); queryClient.invalidateQueries({ queryKey: ["electricity-dashboard"] }); };

  const handleVerify = async (bill: ElectricityBillRow) => {
    try {
      await verifyBill(bill.Id);
      toast.success("Bill verified");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify bill");
    }
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <select value={billStatus} onChange={(e) => setBillStatus(e.target.value)} className={inputCls}>
          <option value="">All Status</option>
          {["PendingVerification", "Verified", "AddedToCustomerBill", "Cancelled", "Revised"].map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <span className="text-xs text-muted-foreground">to</span>
        <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        {rights.canExport && (
          <div className="ml-auto">
            <ExportMenu
              data={rows as unknown as Record<string, unknown>[]}
              title="Electricity Bills"
              filename="electricity-bills"
              columns={[
                { header: "Customer", accessor: "CustomerName" },
                { header: "Flat", accessor: (r) => [r.BlockName, r.UnitNo].filter(Boolean).join(" / ") },
                { header: "Period From", accessor: "BillingPeriodFrom" },
                { header: "Period To", accessor: "BillingPeriodTo" },
                { header: "Total Units", accessor: "TotalUnits" },
                { header: "Rajwada Units", accessor: "RajwadaUnits" },
                { header: "Post-Handover Units", accessor: "PostHandoverUnits" },
                { header: "Amount", accessor: "TotalAmount" },
                { header: "Status", accessor: "BillStatus" },
              ]}
            />
          </div>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">Failed to load bills.</div>}
      {!isLoading && !error && rows.length === 0 && (
        <div className="bg-card border border-dashed border-foreground/40 py-10 text-center text-sm text-muted-foreground">No electricity bills match these filters.</div>
      )}

      {rows.length > 0 && (
        <div className="bg-card border border-foreground overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Customer</th>
                <th className={TH}>Flat</th>
                <th className={TH}>Period</th>
                <th className={TH}>Rajwada Units</th>
                <th className={TH}>Amount</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.Id} className="hover:bg-primary/5">
                  <td className={`${TD} font-medium text-foreground`}>{b.CustomerName}</td>
                  <td className={TD}>{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                  <td className={TD}>{fmtDate(b.BillingPeriodFrom)} – {fmtDate(b.BillingPeriodTo)}</td>
                  <td className={TD}>{b.RajwadaUnits}</td>
                  <td className={`${TD} font-heading tabular-nums font-semibold text-foreground`}>{fmt(b.TotalAmount)}</td>
                  <td className={TD}><BillStatusBadge status={b.BillStatus} /></td>
                  <td className={TD}>
                    <div className="flex items-center justify-end gap-1.5">
                      {rights.canEdit && b.BillStatus === "PendingVerification" && (
                        <button onClick={() => handleVerify(b)} className={`${KEY_LINE} h-8 px-3`}>
                          <CheckCircle2 size={12} /> Verify
                        </button>
                      )}
                      {rights.canEdit && b.BillStatus === "Verified" && (
                        <button onClick={() => setAddingTo(b)} className={`${KEY_INK} h-8 px-3`}>
                          Add to Bill
                        </button>
                      )}
                      {rights.canDelete && (b.BillStatus === "PendingVerification" || b.BillStatus === "Verified") && (
                        <button onClick={() => setCancelling(b)} title="Cancel" className={ICON_ACT_RED}>
                          <Ban size={14} />
                        </button>
                      )}
                      <button onClick={() => setAuditFor(b)} title="View Audit Log" className={ICON_ACT}>
                        <ShieldAlert size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addingTo && <AddToCustomerBillDialog bill={addingTo} onClose={() => setAddingTo(null)} onDone={() => { setAddingTo(null); invalidate(); }} />}
      {cancelling && <CancelBillDialog bill={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); invalidate(); }} />}
      {auditFor && <AuditLogModal title={`Audit Log — Bill #${auditFor.Id}`} filters={{ billId: auditFor.Id }} onClose={() => setAuditFor(null)} />}
    </div>
  );
}

function AddToCustomerBillDialog({ bill, onClose, onDone }: { bill: ElectricityBillRow; onClose: () => void; onDone: () => void }) {
  const [maintenanceBillId, setMaintenanceBillId] = useState("");
  const [saving, setSaving] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["maintenance-bills", { bookingId: bill.BookingId, status: "Active" }],
    queryFn: () => getMaintenanceBills({ bookingId: bill.BookingId, status: "Active" }),
  });
  const rows = Array.isArray(data) ? data : [];

  const handleSubmit = async () => {
    if (!maintenanceBillId) { toast.error("Select the customer's maintenance bill"); return; }
    setSaving(true);
    try {
      await addBillToCustomerBill(bill.Id, Number(maintenanceBillId));
      toast.success("Electricity charge added to the customer's bill");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Failed to add to customer bill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-sm" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Add to Customer's Bill</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="border border-foreground/20 bg-foreground/5 p-2.5 text-xs">
            <p className="text-muted-foreground">Electricity Amount</p>
            <p className="font-heading font-bold text-foreground text-base">{fmt(bill.TotalAmount)}</p>
          </div>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading maintenance bills…</div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No Active maintenance bill exists for this customer yet — create one first from Maintenance → Bills.</p>
          ) : (
            <div>
              <label className={labelCls}>Maintenance Bill</label>
              <select value={maintenanceBillId} onChange={(e) => setMaintenanceBillId(e.target.value)} className={fieldCls}>
                <option value="">Select bill…</option>
                {rows.map((mb) => (<option key={mb.Id} value={mb.Id}>{mb.BillNo} — {fmt(mb.GrandTotal)}</option>))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
            <button onClick={handleSubmit} disabled={saving || rows.length === 0} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Add to Bill
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelBillDialog({ bill, onClose, onDone }: { bill: ElectricityBillRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!reason.trim()) { toast.error("A reason is required"); return; }
    setSaving(true);
    try {
      await cancelBill(bill.Id, reason.trim());
      toast.success("Bill cancelled");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel bill");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-sm" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Cancel Electricity Bill</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div><label className={labelCls}>Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={`${HR_FIELD} h-auto py-2 resize-none`} /></div>
          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Back</button>
            <button onClick={handleSubmit} disabled={saving} className={`${KEY_RED_SOLID} h-9 px-5 flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Cancel Bill
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────────
function ReportsTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { data: monthly, isLoading: monthlyLoading } = useQuery({ queryKey: ["electricity-report-monthly", dateFrom, dateTo], queryFn: () => getMonthlyReport(dateFrom || undefined, dateTo || undefined) });
  const { data: providerWise, isLoading: providerLoading } = useQuery({ queryKey: ["electricity-report-provider", dateFrom, dateTo], queryFn: () => getProviderWiseReport(dateFrom || undefined, dateTo || undefined) });
  const { data: customerWise, isLoading: customerLoading } = useQuery({ queryKey: ["electricity-report-customer", dateFrom, dateTo], queryFn: () => getCustomerWiseReport(dateFrom || undefined, dateTo || undefined) });

  return (
    <div className="space-y-5 pt-1">
      <div className="flex items-center gap-2">
        <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <span className="text-xs text-muted-foreground">to</span>
        <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
      </div>

      <div>
        <h3 className={`${HR_HEAD} mb-2`}>Summary</h3>
        {monthlyLoading ? (
          <div className="skel" style={{ height: 150 }} />
        ) : (
          <div className="space-y-px">
            <HrStatStrip items={[
              { label: "Total Meters", value: monthly?.totalMeters ?? 0 },
              { label: "Readings Completed", value: monthly?.readingsCompleted ?? 0 },
              { label: "Total Units Consumed", value: monthly?.totalUnitsConsumed ?? 0 },
            ]} />
            <HrStatStrip items={[
              { label: "Rajwada Supply Units", value: monthly?.rajwadaSupplyUnits ?? 0 },
              { label: "Post-Handover Units", value: monthly?.postHandoverUnits ?? 0 },
              { label: "Total Electricity", value: fmt(monthly?.totalElectricityAmount) },
            ]} />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className={HR_HEAD}>Provider-wise</h3>
          {rights.canExport && providerWise && providerWise.length > 0 && (
            <ExportMenu
              data={providerWise as unknown as Record<string, unknown>[]}
              title="Electricity — Provider-wise Report"
              filename="electricity-provider-wise-report"
              columns={[
                { header: "Provider", accessor: "ProviderName" },
                { header: "Meters", accessor: "MeterCount" },
                { header: "Units", accessor: "TotalUnits" },
                { header: "Amount", accessor: "TotalAmount" },
              ]}
            />
          )}
        </div>
        {providerLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !providerWise?.length ? (
          <div className="bg-card border border-dashed border-foreground/40 py-6 text-center text-sm text-muted-foreground">No billed data in this range.</div>
        ) : (
          <div className="bg-card border border-foreground overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Meters</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {providerWise.map((p) => (
                  <tr key={p.ProviderName}>
                    <td className={`${TD} font-medium text-foreground`}>{p.ProviderName}</td>
                    <td className={TD}>{p.MeterCount}</td>
                    <td className={TD}>{p.TotalUnits}</td>
                    <td className={`${TD} font-heading tabular-nums`}>{fmt(p.TotalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className={HR_HEAD}>Customer-wise</h3>
          {rights.canExport && customerWise && customerWise.length > 0 && (
            <ExportMenu
              data={customerWise as unknown as Record<string, unknown>[]}
              title="Electricity — Customer-wise Report"
              filename="electricity-customer-wise-report"
              columns={[
                { header: "Customer", accessor: "CustomerName" },
                { header: "Flat", accessor: (r) => [r.BlockName, r.UnitNo].filter(Boolean).join(" / ") },
                { header: "Meter", accessor: "MeterNumber" },
                { header: "Period From", accessor: "BillingPeriodFrom" },
                { header: "Period To", accessor: "BillingPeriodTo" },
                { header: "Units", accessor: "TotalUnits" },
                { header: "Handover Date", accessor: "HandoverDate" },
                { header: "Rajwada Units", accessor: "RajwadaUnits" },
                { header: "Amount", accessor: "TotalAmount" },
                { header: "Status", accessor: "BillStatus" },
              ]}
            />
          )}
        </div>
        {customerLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !customerWise?.length ? (
          <div className="bg-card border border-dashed border-foreground/40 py-6 text-center text-sm text-muted-foreground">No billed data in this range.</div>
        ) : (
          <div className="bg-card border border-foreground overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Flat</th>
                  <th className={TH}>Meter</th>
                  <th className={TH}>Period</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>Handover Date</th>
                  <th className={TH}>Rajwada Units</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {customerWise.map((b) => (
                  <tr key={b.Id}>
                    <td className={`${TD} font-medium text-foreground`}>{b.CustomerName}</td>
                    <td className={TD}>{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                    <td className={`${TD} font-heading tabular-nums text-xs`}>{b.MeterNumber}</td>
                    <td className={TD}>{fmtDate(b.BillingPeriodFrom)} – {fmtDate(b.BillingPeriodTo)}</td>
                    <td className={TD}>{b.TotalUnits}</td>
                    <td className={TD}>{fmtDate(b.HandoverDate)}</td>
                    <td className={TD}>{b.RajwadaUnits}</td>
                    <td className={`${TD} font-heading tabular-nums`}>{fmt(b.TotalAmount)}</td>
                    <td className={TD}><BillStatusBadge status={b.BillStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Log ───────────────────────────────────────────────────────────
function AuditLogList({ rows }: { rows: { Id: number; Action: string; PerformedAt: string; PerformedBy: string | null; Remarks: string | null }[] }) {
  if (rows.length === 0) {
    return <div className="bg-card border border-dashed border-foreground/40 py-10 text-center text-sm text-muted-foreground">No audit entries yet.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map((l) => (
        <div key={l.Id} className="border border-foreground/20 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-heading font-semibold text-foreground">{l.Action}</span>
            <span className="text-muted-foreground">{fmtDateTime(l.PerformedAt)}</span>
          </div>
          <div className="text-muted-foreground mt-0.5">By: {l.PerformedBy || "—"}{l.Remarks ? ` — ${l.Remarks}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

function AuditTab() {
  const { data, isLoading } = useQuery({ queryKey: ["electricity-audit-log"], queryFn: () => getElectricityAuditLog({}) });
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="pt-1">
      {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : <AuditLogList rows={rows} />}
    </div>
  );
}

// Reusable "View Audit Log" dialog, opened from a specific meter or bill
// row so the trail doesn't have to be hunted for in the flat global list.
function AuditLogModal({ title, filters, onClose }: { title: string; filters: { meterId?: number; billId?: number; readingId?: number }; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["electricity-audit-log", filters], queryFn: () => getElectricityAuditLog(filters) });
  const rows = Array.isArray(data) ? data : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-lg max-h-[80vh] overflow-y-auto" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>{title}</DialogTitle></DialogHeader>
        <div className="pt-1">
          {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : <AuditLogList rows={rows} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
