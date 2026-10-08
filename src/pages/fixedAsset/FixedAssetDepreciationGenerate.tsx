import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, CheckCircle2, Clock3, History, Loader2, Play, ListChecks, Ban } from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  generateDepreciation, getGeneratePreview, getGenerateRuns, getPostingHistory,
  type GenerateAssetRow, type GenerateOutcome, type GenerateResult,
} from "@/api/fixedAssetDepreciationGenerateApi";

const fmtAmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtDateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

const selectCls =
  "w-full h-10 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

/** "YYYY-MM" of the month before today — the most recent month that has closed. */
function lastClosedMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type Tab = "assets" | "history" | "log";

function Badge({ tone, children }: { tone: "green" | "blue" | "amber" | "slate" | "red"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    slate: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export default function FixedAssetDepreciationGenerate() {
  const rights = usePageRights("fixed-asset-depreciation-generate");
  const qc = useQueryClient();

  const [projectId, setProjectId] = useState("");
  const [monthValue, setMonthValue] = useState(lastClosedMonth());
  const [tab, setTab] = useState<Tab>("assets");
  // What the last Generate click did for the selected project + month (to show "newly generated").
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null);

  const [year, month] = useMemo(() => {
    const [y, m] = monthValue.split("-").map(Number);
    return [y || 0, m || 0] as const;
  }, [monthValue]);

  useEffect(() => { setLastResult(null); }, [projectId, monthValue]);

  const { data: projects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
  });

  const pid = Number(projectId) || 0;
  const ready = pid > 0 && year > 0 && month > 0;

  const { data: preview, isFetching: loadingPreview, error: previewError } = useQuery({
    queryKey: ["fa-dep-generate-preview", pid, year, month],
    queryFn: () => getGeneratePreview(pid, year, month),
    enabled: ready,
  });
  const { data: history = [] } = useQuery({
    queryKey: ["fa-dep-generate-history", pid],
    queryFn: () => getPostingHistory(pid),
    enabled: pid > 0 && tab === "history",
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["fa-dep-generate-runs", pid],
    queryFn: () => getGenerateRuns(pid),
    enabled: pid > 0 && tab === "log",
  });

  const generate = useMutation({
    mutationFn: () => generateDepreciation(pid, year, month),
    onSuccess: (res) => {
      setLastResult(res);
      const c = res.counts;
      if (c.generated > 0) toast.success(`${c.generated} asset${c.generated === 1 ? "" : "s"} generated for ${monthLabel(year, month)} — ₹${fmtAmt(res.totalAmount)}`);
      else if (c.failed > 0) toast.error(`Nothing was generated — ${c.failed} asset(s) failed`);
      else toast.info(`Nothing new to generate — ${c.alreadyPosted} already posted${c.skipped ? `, ${c.skipped} not due` : ""}`);
      if (c.failed > 0 && c.generated > 0) toast.warning(`${c.failed} asset(s) failed — see the list`);
      qc.invalidateQueries({ queryKey: ["fa-dep-generate-preview"] });
      qc.invalidateQueries({ queryKey: ["fa-dep-generate-history"] });
      qc.invalidateQueries({ queryKey: ["fa-dep-generate-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const outcomeOf = useMemo(() => {
    const m = new Map<number, GenerateOutcome>();
    for (const r of lastResult?.results ?? []) m.set(r.assetId, r.outcome);
    return m;
  }, [lastResult]);
  const failedMsg = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of lastResult?.results ?? []) if (r.outcome === "failed" && r.message) m.set(r.assetId, r.message);
    return m;
  }, [lastResult]);

  const handleGenerate = () => {
    if (!preview) return;
    const n = preview.counts.pending;
    const msg = `Generate ${monthLabel(year, month)} depreciation for ${n} asset${n === 1 ? "" : "s"}?` +
      (preview.counts.posted ? `\n${preview.counts.posted} already-posted asset(s) will be skipped.` : "");
    if (window.confirm(msg)) generate.mutate();
  };

  const statusBadge = (r: GenerateAssetRow) => {
    const outcome = outcomeOf.get(r.assetId);
    if (outcome === "generated") return <Badge tone="blue"><CheckCircle2 size={12} /> Newly generated</Badge>;
    if (outcome === "failed") return <Badge tone="red"><Ban size={12} /> Failed</Badge>;
    if (r.state === "posted") return <Badge tone="green"><CheckCircle2 size={12} /> Already posted</Badge>;
    if (r.state === "pending") return <Badge tone="amber"><Clock3 size={12} /> Due — will be generated</Badge>;
    return <Badge tone="slate"><Ban size={12} /> Not eligible</Badge>;
  };

  const monthBadge = preview && (
    preview.monthStatus === "Generated" ? <Badge tone="green"><CheckCircle2 size={12} /> {monthLabel(year, month)} — Posted / Generated</Badge>
    : preview.monthStatus === "Partially generated" ? <Badge tone="amber"><Clock3 size={12} /> {monthLabel(year, month)} — Partially generated</Badge>
    : <Badge tone="slate">{monthLabel(year, month)} — Not generated</Badge>
  );

  return (
    <GlassShell
      title="Fixed Asset Depreciation Generate"
      subtitle="Generate a month's depreciation for every depreciation-tagged asset of a project"
      icon={Calculator}
      accentColor="#eab308"
    >
      <Breadcrumbs items={["Fixed Asset", "Fixed Asset Depreciation Generate"]} />

      {/* Selection */}
      <div className="rounded-xl border border-border bg-card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px_auto] gap-4 items-end">
          <div>
            <label className={labelCls}>Project *</label>
            <select className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Month *</label>
            <input type="month" className={selectCls} value={monthValue} max={currentMonth()} onChange={(e) => setMonthValue(e.target.value)} />
          </div>
          {rights.canCreate && (
            <button
              onClick={handleGenerate}
              disabled={!ready || !preview || preview.counts.pending === 0 || generate.isPending}
              title={preview && preview.counts.pending === 0 ? "Nothing is due for this project and month" : "Generate depreciation"}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold text-white btn-module disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Generate{preview && preview.counts.pending > 0 ? ` (${preview.counts.pending})` : ""}
            </button>
          )}
        </div>
        {preview && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {monthBadge}
            <span className="text-xs text-muted-foreground">
              {preview.counts.total} depreciation-tagged asset{preview.counts.total === 1 ? "" : "s"} ·{" "}
              {preview.counts.posted} posted · {preview.counts.pending} due · {preview.counts.notEligible} not eligible
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {([["assets", "Assets", ListChecks], ["history", "Posting History", History], ["log", "Generation Log", Clock3]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k ? "border-yellow-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {!ready && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Select a Project and a Month to see its depreciation-tagged assets.
        </div>
      )}

      {ready && tab === "assets" && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          {previewError ? (
            <p className="p-6 text-sm text-destructive">{(previewError as Error).message}</p>
          ) : loadingPreview && !preview ? (
            <p className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          ) : !preview || preview.rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No depreciation-tagged assets under this project yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">FA Item Code</th>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Method / Rate</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">{monthLabel(year, month)} Depreciation</th>
                  <th className="px-4 py-3 text-right">Book Value After</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Voucher / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.assetId} className={r.state === "notEligible" ? "opacity-70" : ""}>
                    <td className="px-4 py-3 font-mono text-xs text-yellow-600 dark:text-yellow-400">{r.faItemCode}</td>
                    <td className="px-4 py-3">{r.assetName || "—"}</td>
                    <td className="px-4 py-3 text-xs">{r.method ? `${r.method} · ${r.ratePct ?? 0}%` : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(r.purchaseCost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{r.state === "notEligible" ? "—" : fmtAmt(r.amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.state === "notEligible" ? "—" : fmtAmt(r.closingBookValue)}</td>
                    <td className="px-4 py-3">{statusBadge(r)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[320px]">
                      {failedMsg.get(r.assetId) ? <span className="text-destructive">{failedMsg.get(r.assetId)}</span>
                        : r.state === "posted" ? <>{r.voucherNo} · {fmtDateTime(r.postedAt)}</>
                        : r.state === "notEligible" ? r.reason
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {ready && tab === "history" && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          {history.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No depreciation has been posted for this project yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Project</th>
                  <th className="px-4 py-3 text-left">Month</th>
                  <th className="px-4 py-3 text-left">FA Item Code</th>
                  <th className="px-4 py-3 text-right">Depreciation</th>
                  <th className="px-4 py-3 text-right">Accumulated</th>
                  <th className="px-4 py-3 text-right">Book Value</th>
                  <th className="px-4 py-3 text-left">Posting Date</th>
                  <th className="px-4 py-3 text-left">Voucher</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h) => (
                  <tr key={h.EntryId} className={h.PostingStatus === "Reversed" ? "opacity-60" : ""}>
                    <td className="px-4 py-3">{h.ProjectName || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{monthLabel(h.PeriodYear, h.PeriodMonth)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-yellow-600 dark:text-yellow-400">{h.FAItemCode || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtAmt(h.DepreciationAmount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(h.AccumulatedDepreciation)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(h.ClosingBookValue)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{fmtDateTime(h.PostedAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{h.VoucherNo || "—"}</td>
                    <td className="px-4 py-3">
                      {h.PostingStatus === "Posted" ? <Badge tone="green">Posted</Badge> : <Badge tone="slate">Reversed</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {ready && tab === "log" && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          {runs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Generate hasn't been run for this project yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Run At</th>
                  <th className="px-4 py-3 text-left">Month</th>
                  <th className="px-4 py-3 text-right">Newly Generated</th>
                  <th className="px-4 py-3 text-right">Already Posted</th>
                  <th className="px-4 py-3 text-right">Not Due</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.RunId}>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{fmtDateTime(r.StartedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{monthLabel(r.PeriodYear, r.PeriodMonth)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.Generated}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.AlreadyPosted}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.Skipped}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.Failed || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(r.TotalAmount)}</td>
                    <td className="px-4 py-3 text-xs">{r.RunBy || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </GlassShell>
  );
}
