import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Zap, Gauge, Users, Clock3, Receipt, Wallet, Plus, Search, FileText,
  CheckCircle2, Ban, Loader2, History as HistoryIcon, BarChart3, ShieldAlert,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { GlassCard } from "@/components/dashboard/GlassShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportMenu } from "@/components/ExportMenu";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import {
  getMeters, getElectricityDashboard, getElectricityProviders, getNextReadingInfo, recordReading,
  getMeterReadings, correctReading, previewBill, generateBill, getElectricityBills, verifyBill,
  addBillToCustomerBill, cancelBill, getMonthlyReport, getProviderWiseReport, getCustomerWiseReport, getElectricityAuditLog,
  type MeterRow, type ElectricityBillRow, type BillPreview, type MeterReadingRow, type BillStatus,
} from "@/api/electricityMaintenanceApi";

const PAGE_KEY = "maintenance-electricity";
const TABS = ["overview", "meters", "bills", "reports", "audit"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", meters: "Meters & Readings", bills: "Billing", reports: "Reports", audit: "Audit Log" };

const inputCls = "px-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelCls = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const fieldCls = "w-full px-3.5 py-2.5 rounded-xl text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 text-foreground";
const fmt = (n: number | null | undefined) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN") : "—");

const BILL_STATUS_STYLE: Record<BillStatus, string> = {
  PendingVerification: "bg-amber-500/10 border-amber-500/20 text-amber-600",
  Verified: "bg-sky-500/10 border-sky-500/20 text-sky-600",
  AddedToCustomerBill: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
  Cancelled: "bg-red-500/10 border-red-500/20 text-red-600",
  Revised: "bg-violet-500/10 border-violet-500/20 text-violet-600",
};
function BillStatusBadge({ status }: { status: BillStatus }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${BILL_STATUS_STYLE[status] || ""}`}>{status}</span>;
}
function HandoverBadge({ status }: { status: string }) {
  const style = status === "Handover Completed" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600"
    : status === "Handover Scheduled" ? "bg-amber-500/10 border-amber-500/20 text-amber-600"
    : "bg-muted border-border text-muted-foreground";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${style}`}>{status}</span>;
}

export default function ElectricityMaintenance() {
  const rights = usePageRights(PAGE_KEY);
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Electricity Maintenance"]} />
      <MaintenanceShell title="Electricity Maintenance" subtitle="Meter readings, tariff-based billing and the Rajwada/handover split" icon={Zap}>
        <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-semibold transition-all ${tab === t ? "text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              style={tab === t ? { background: ACCENT } : undefined}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
      <GlassCard label="Total Meters" value={isLoading ? "…" : data?.totalMeters ?? 0} icon={Gauge} accentColor={ACCENT} />
      <GlassCard label="Reading Pending" value={isLoading ? "…" : data?.readingPending ?? 0} icon={Clock3} accentColor="#f59e0b" />
      <GlassCard label="Bills Generated" value={isLoading ? "…" : data?.billsGenerated ?? 0} icon={Receipt} accentColor="#0ea5e9" />
      <GlassCard label="Current Amount" value={isLoading ? "…" : fmt(data?.currentAmount)} icon={Wallet} accentColor="#22c55e" />
    </div>
  );
}

// ─── Meters & Readings ───────────────────────────────────────────────────
function MetersTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const [search, setSearch] = useState("");
  const [providerId, setProviderId] = useState("");
  const [billingCycle, setBillingCycle] = useState("");
  const [status, setStatus] = useState("");
  const [readingFor, setReadingFor] = useState<MeterRow | null>(null);
  const [billingFor, setBillingFor] = useState<MeterRow | null>(null);
  const [historyFor, setHistoryFor] = useState<MeterRow | null>(null);

  const { data: providers } = useQuery({ queryKey: ["electricity-providers"], queryFn: getElectricityProviders });
  const filters = useMemo(() => ({ search, providerId: providerId || undefined, billingCycle: billingCycle || undefined, status: status || undefined }), [search, providerId, billingCycle, status]);
  const { data, isLoading, error } = useQuery({ queryKey: ["electricity-meters", filters], queryFn: () => getMeters(filters) });
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, flat, meter, box…" className={`pl-8 pr-3 w-64 ${inputCls}`} />
        </div>
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputCls}>
          <option value="">All Providers</option>
          {(providers || []).map((p) => (<option key={p.Id} value={p.Id}>{p.Name}</option>))}
        </select>
        <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} className={inputCls}>
          <option value="">All Cycles</option>
          <option value="Monthly">Monthly</option>
          <option value="3 Monthly">3 Monthly</option>
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
                { header: "Status", accessor: "Status" },
              ]}
            />
          </div>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Failed to load meters.</div>}
      {!isLoading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No meters match these filters. Add meters via Maintenance Setup → Meter Reading Master.
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
              <tr>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Flat</th>
                <th className="text-left px-4 py-2.5">Meter Box</th>
                <th className="text-left px-4 py-2.5">Meter No.</th>
                <th className="text-left px-4 py-2.5">Provider</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <tr key={m.Id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{m.CustomerName}</td>
                  <td className="px-4 py-2.5">{[m.BlockName, m.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{m.MeterBoxNumber || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{m.MeterNumber}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{m.ProviderName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${m.Status === "Active" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-muted border-border text-muted-foreground"}`}>{m.Status}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {rights.canCreate && m.Status === "Active" && (
                        <button onClick={() => setReadingFor(m)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-semibold gradient-maintenance text-white">
                          <Plus size={12} /> Reading
                        </button>
                      )}
                      {rights.canCreate && m.Status === "Active" && (
                        <button onClick={() => setBillingFor(m)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-medium border border-border text-foreground hover:bg-muted">
                          <FileText size={12} /> Generate Bill
                        </button>
                      )}
                      <button onClick={() => setHistoryFor(m)} title="View History" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                        <HistoryIcon size={14} />
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
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Add Meter Reading</DialogTitle></DialogHeader>
        {isLoading || !info ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2 text-xs rounded-lg bg-muted/30 p-2.5">
              <div><p className="text-muted-foreground">Customer</p><p className="font-medium text-foreground">{meter.CustomerName}</p></div>
              <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{[meter.BlockName, meter.UnitNo].filter(Boolean).join(" / ") || "—"}</p></div>
              <div><p className="text-muted-foreground">Meter Box</p><p className="font-medium text-foreground">{meter.MeterBoxNumber || "—"}</p></div>
              <div><p className="text-muted-foreground">Meter No.</p><p className="font-mono font-medium text-foreground">{meter.MeterNumber}</p></div>
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
              <input value={info.previousReading} disabled className={`${fieldCls} disabled:opacity-70 font-mono`} />
            </div>
            <div>
              <label className={labelCls}>Current Reading</label>
              <input type="number" value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} className={fieldCls} autoFocus />
            </div>
            <div>
              <label className={labelCls}>Reading Date</label>
              <input type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} className={fieldCls} />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
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
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading text-base">Generate Electricity Bill</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Period From</label><input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className={fieldCls} /></div>
            <div><label className={labelCls}>Period To</label><input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className={fieldCls} /></div>
          </div>
          <button onClick={loadPreview} disabled={loadingPreview} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-border text-foreground hover:bg-muted disabled:opacity-60">
            {loadingPreview ? <Loader2 size={13} className="animate-spin" /> : null} Preview
          </button>

          {previewError && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" /> {previewError}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-border p-3 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-muted-foreground">Customer</p><p className="font-medium text-foreground">{preview.customerName}</p></div>
                <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{[preview.blockName, preview.unitNo].filter(Boolean).join(" / ") || "—"}</p></div>
                <div><p className="text-muted-foreground">Meter</p><p className="font-mono font-medium text-foreground">{preview.meterNumber}</p></div>
                <div><p className="text-muted-foreground">Provider</p><p className="font-medium text-foreground">{preview.providerName}</p></div>
              </div>
              <div className="border-t border-border pt-2 grid grid-cols-2 gap-2">
                <div><p className="text-muted-foreground">Previous Reading</p><p className="font-mono font-medium text-foreground">{preview.previousReading}</p></div>
                <div><p className="text-muted-foreground">Current Reading</p><p className="font-mono font-medium text-foreground">{preview.currentReading}</p></div>
                <div><p className="text-muted-foreground">Consumption</p><p className="font-medium text-foreground">{preview.totalUnits} Units</p></div>
                <div><p className="text-muted-foreground">Handover Status</p><HandoverBadge status={preview.handoverStatus} /></div>
              </div>
              {preview.handoverDate && (
                <div className="border-t border-border pt-2 grid grid-cols-2 gap-2">
                  <div><p className="text-muted-foreground">Handover Date</p><p className="font-medium text-foreground">{fmtDate(preview.handoverDate)}</p></div>
                  <div><p className="text-muted-foreground">Handover Reading</p><p className="font-mono font-medium text-foreground">{preview.handoverReading ?? "—"}</p></div>
                  <div><p className="text-muted-foreground">Rajwada Consumption</p><p className="font-semibold text-foreground">{preview.rajwadaUnits} Units</p></div>
                  <div><p className="text-muted-foreground">Post-Handover</p><p className="font-medium text-foreground">{preview.postHandoverUnits} Units</p></div>
                </div>
              )}
              <div className="border-t border-border pt-2 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Energy Charge</span><span className="font-mono">{fmt(preview.energyCharge)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fixed Charge</span><span className="font-mono">{fmt(preview.fixedCharge)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Other Charge</span><span className="font-mono">{fmt(preview.otherCharge)}</span></div>
                <div className="flex justify-between font-heading font-bold text-foreground border-t border-border pt-1"><span>Electricity Amount</span><span className="font-mono">{fmt(preview.totalAmount)}</span></div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleGenerate} disabled={!preview || generating} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading text-base">Reading History — {meter.MeterNumber}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No readings recorded yet.</div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Date</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Type</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Previous</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Current</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Units</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Bill</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bill = billForReading(r);
                  return (
                  <tr key={r.Id} className={`border-t border-border/60 ${r.IsSuperseded ? "opacity-50" : ""}`}>
                    <td className="px-2 py-1.5">{fmtDate(r.ReadingDate)}</td>
                    <td className="px-2 py-1.5">{r.ReadingType}</td>
                    <td className="px-2 py-1.5 font-mono">{r.PreviousReading}</td>
                    <td className="px-2 py-1.5 font-mono">{r.CurrentReading}</td>
                    <td className="px-2 py-1.5">{r.UnitsConsumed}</td>
                    <td className="px-2 py-1.5 font-mono">{bill ? fmt(bill.TotalAmount) : "—"}</td>
                    <td className="px-2 py-1.5">{r.IsSuperseded ? "Superseded" : "Active"}</td>
                    <td className="px-1 py-1.5 text-center">
                      {!r.IsSuperseded && (
                        <button onClick={() => setCorrecting(r)} title="Correct" className="text-muted-foreground hover:text-foreground">
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
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Correct Reading</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">Original current reading: <span className="font-mono text-foreground">{reading.CurrentReading}</span>. The original is kept in history, never deleted.</p>
          <div><label className={labelCls}>Corrected Current Reading</label><input type="number" value={correctedCurrentReading} onChange={(e) => setCorrectedCurrentReading(e.target.value)} className={fieldCls} /></div>
          <div><label className={labelCls}>Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" /></div>
          <div><label className={labelCls}>Approved By</label><input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={fieldCls} /></div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
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
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
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
      {error && <div className="text-sm text-red-500">Failed to load bills.</div>}
      {!isLoading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No electricity bills match these filters.</div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
              <tr>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Flat</th>
                <th className="text-left px-4 py-2.5">Period</th>
                <th className="text-left px-4 py-2.5">Rajwada Units</th>
                <th className="text-left px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((b) => (
                <tr key={b.Id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{b.CustomerName}</td>
                  <td className="px-4 py-2.5">{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-2.5">{fmtDate(b.BillingPeriodFrom)} – {fmtDate(b.BillingPeriodTo)}</td>
                  <td className="px-4 py-2.5">{b.RajwadaUnits}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-foreground">{fmt(b.TotalAmount)}</td>
                  <td className="px-4 py-2.5"><BillStatusBadge status={b.BillStatus} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {rights.canEdit && b.BillStatus === "PendingVerification" && (
                        <button onClick={() => handleVerify(b)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-semibold border border-border text-foreground hover:bg-muted">
                          <CheckCircle2 size={12} /> Verify
                        </button>
                      )}
                      {rights.canEdit && b.BillStatus === "Verified" && (
                        <button onClick={() => setAddingTo(b)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-semibold gradient-maintenance text-white">
                          Add to Bill
                        </button>
                      )}
                      {rights.canDelete && (b.BillStatus === "PendingVerification" || b.BillStatus === "Verified") && (
                        <button onClick={() => setCancelling(b)} title="Cancel" className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Ban size={14} />
                        </button>
                      )}
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
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Add to Customer's Bill</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="rounded-lg bg-muted/30 p-2.5 text-xs">
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
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSubmit} disabled={saving || rows.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
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
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Cancel Electricity Bill</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div><label className={labelCls}>Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" /></div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Back</button>
            <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-destructive text-destructive-foreground disabled:opacity-60">
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
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
      </div>

      <div>
        <h3 className="text-xs font-heading font-semibold text-foreground mb-2 flex items-center gap-1.5"><BarChart3 size={13} /> Summary</h3>
        {monthlyLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <GlassCard label="Total Meters" value={monthly?.totalMeters ?? 0} icon={Gauge} accentColor={ACCENT} />
            <GlassCard label="Readings Completed" value={monthly?.readingsCompleted ?? 0} icon={CheckCircle2} accentColor="#0ea5e9" />
            <GlassCard label="Total Units Consumed" value={monthly?.totalUnitsConsumed ?? 0} icon={Zap} accentColor="#f59e0b" />
            <GlassCard label="Rajwada Supply Units" value={monthly?.rajwadaSupplyUnits ?? 0} icon={Users} accentColor="#8b5cf6" />
            <GlassCard label="Post-Handover Units" value={monthly?.postHandoverUnits ?? 0} icon={Users} accentColor="#94a3b8" />
            <GlassCard label="Total Electricity" value={fmt(monthly?.totalElectricityAmount)} icon={Wallet} accentColor="#22c55e" />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-heading font-semibold text-foreground">Provider-wise</h3>
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
          <div className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No billed data in this range.</div>
        ) : (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Provider</th>
                  <th className="text-left px-4 py-2.5">Meters</th>
                  <th className="text-left px-4 py-2.5">Units</th>
                  <th className="text-left px-4 py-2.5">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {providerWise.map((p) => (
                  <tr key={p.ProviderName}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{p.ProviderName}</td>
                    <td className="px-4 py-2.5">{p.MeterCount}</td>
                    <td className="px-4 py-2.5">{p.TotalUnits}</td>
                    <td className="px-4 py-2.5 font-mono">{fmt(p.TotalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-heading font-semibold text-foreground">Customer-wise</h3>
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
          <div className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No billed data in this range.</div>
        ) : (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Customer</th>
                  <th className="text-left px-4 py-2.5">Flat</th>
                  <th className="text-left px-4 py-2.5">Meter</th>
                  <th className="text-left px-4 py-2.5">Period</th>
                  <th className="text-left px-4 py-2.5">Units</th>
                  <th className="text-left px-4 py-2.5">Handover Date</th>
                  <th className="text-left px-4 py-2.5">Rajwada Units</th>
                  <th className="text-left px-4 py-2.5">Amount</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customerWise.map((b) => (
                  <tr key={b.Id}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{b.CustomerName}</td>
                    <td className="px-4 py-2.5">{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{b.MeterNumber}</td>
                    <td className="px-4 py-2.5">{fmtDate(b.BillingPeriodFrom)} – {fmtDate(b.BillingPeriodTo)}</td>
                    <td className="px-4 py-2.5">{b.TotalUnits}</td>
                    <td className="px-4 py-2.5">{fmtDate(b.HandoverDate)}</td>
                    <td className="px-4 py-2.5">{b.RajwadaUnits}</td>
                    <td className="px-4 py-2.5 font-mono">{fmt(b.TotalAmount)}</td>
                    <td className="px-4 py-2.5"><BillStatusBadge status={b.BillStatus} /></td>
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
function AuditTab() {
  const { data, isLoading } = useQuery({ queryKey: ["electricity-audit-log"], queryFn: () => getElectricityAuditLog({}) });
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="pt-1">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No audit entries yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((l) => (
            <div key={l.Id} className="rounded-lg border border-border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-heading font-semibold text-foreground">{l.Action}</span>
                <span className="text-muted-foreground">{fmtDateTime(l.PerformedAt)}</span>
              </div>
              <div className="text-muted-foreground mt-0.5">By: {l.PerformedBy || "—"}{l.Remarks ? ` — ${l.Remarks}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
