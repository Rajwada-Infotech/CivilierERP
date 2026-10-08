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
import { MonthInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const fmtAmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtDateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

const selectCls =
  "w-full h-10 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "flex items-center text-xs font-semibold text-muted-foreground mb-1.5";

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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const handleGenerate = () => {
    if (!preview) return;
    setConfirmOpen(true);
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
    preview.monthStatus === "Generated" ? <Badge tone="green"><CheckCircle2 size={12} /> Posted / Generated</Badge>
    : preview.monthStatus === "Partially generated" ? <Badge tone="amber"><Clock3 size={12} /> Partially generated</Badge>
    : <Badge tone="slate">Not generated</Badge>
  );
  // Display-only: total of what Generate would post now.
  const dueAmount = useMemo(
    () => (preview?.rows ?? []).filter((r) => r.state === "pending").reduce((t, r) => t + (Number(r.amount) || 0), 0),
    [preview],
  );
  const projectLabel = projects.find((p) => String(p.id) === projectId)?.label;
  const tabCount: Record<Tab, number | undefined> = {
    assets: preview?.rows.length,
    history: tab === "history" ? history.length : undefined,
    log: tab === "log" ? runs.length : undefined,
  };

  const th = "px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
  const Empty = ({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) => (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 flex items-center justify-center mb-1"><Icon size={22} className="text-yellow-600 dark:text-yellow-400" /></div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-sm">{text}</p>
    </div>
  );

  return (
    <GlassShell
      title="Fixed Asset Depreciation Generate"
      subtitle="Generate a month's depreciation for every depreciation-tagged asset of a project"
      icon={Calculator}
      accentColor="#eab308"
    >
      <Breadcrumbs items={["Fixed Asset", "Fixed Asset Depreciation Generate"]} />

      {/* ── Step bar: pick project + month, then Generate ── */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 mb-5 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_14rem_auto] gap-3 sm:gap-4 items-end">
          <div className="min-w-0">
            <label className={labelCls}><span className="inline-flex items-center justify-center w-4 h-4 mr-1.5 rounded-full bg-yellow-500 text-[0.625rem] font-bold text-white">1</span>Project <span className="text-destructive">*</span></label>
            <SearchableNativeSelect className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)} searchPlaceholder="Search project…">
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </SearchableNativeSelect>
          </div>
          <div className="min-w-0">
            <label className={labelCls}><span className="inline-flex items-center justify-center w-4 h-4 mr-1.5 rounded-full bg-yellow-500 text-[0.625rem] font-bold text-white">2</span>Month <span className="text-destructive">*</span></label>
            <MonthInput className={selectCls} value={monthValue} max={currentMonth()} clearable={false} onChange={(e) => setMonthValue(e.target.value)} />
          </div>
          {rights.canCreate && (
            <button
              onClick={handleGenerate}
              disabled={!ready || !preview || preview.counts.pending === 0 || generate.isPending}
              title={preview && preview.counts.pending === 0 ? "Nothing is due for this project and month" : "Generate depreciation"}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold text-white btn-module disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
            >
              {generate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Generate{preview && preview.counts.pending > 0 ? ` (${preview.counts.pending})` : ""}
            </button>
          )}
        </div>

        {/* ── Month summary ── */}
        {ready && preview && (
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-foreground">{monthLabel(year, month)}</span>
              {projectLabel && <span className="text-xs text-muted-foreground">· {projectLabel}</span>}
              {monthBadge}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
              {([
                ["Tagged assets", preview.counts.total, "text-foreground", "bg-muted/40"],
                ["Already posted", preview.counts.posted, "text-emerald-600 dark:text-emerald-400", "bg-emerald-500/10"],
                ["Due now", preview.counts.pending, "text-amber-600 dark:text-amber-400", "bg-amber-500/10"],
                ["Not eligible", preview.counts.notEligible, "text-slate-600 dark:text-slate-300", "bg-slate-500/10"],
              ] as const).map(([label, n, tc, bg]) => (
                <div key={label} className={`rounded-xl px-3.5 py-2.5 ${bg}`}>
                  <p className={`text-xl font-bold tabular-nums leading-tight ${tc}`}>{n}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">{label}</p>
                </div>
              ))}
              <div className="rounded-xl px-3.5 py-2.5 bg-yellow-500/10 col-span-2 lg:col-span-1">
                <p className="text-xl font-bold tabular-nums leading-tight text-yellow-700 dark:text-yellow-400">₹{fmtAmt(dueAmount)}</p>
                <p className="text-[0.6875rem] text-muted-foreground">Amount due to post</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 p-1 mb-4 rounded-xl bg-muted/50 border border-border w-full sm:w-fit overflow-x-auto">
        {([["assets", "Assets", ListChecks], ["history", "Posting History", History], ["log", "Generation Log", Clock3]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              tab === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={14} /> {label}
            {ready && tabCount[k] != null && (
              <span className={`ml-0.5 rounded-full px-1.5 text-[0.625rem] font-semibold ${tab === k ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" : "bg-muted text-muted-foreground"}`}>{tabCount[k]}</span>
            )}
          </button>
        ))}
      </div>

      {!ready && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <Empty icon={Calculator} title="Pick a project and a month" text="Choose the project and the month to close above — every depreciation-tagged asset under it is listed here with what Generate will post." />
        </div>
      )}

      {ready && tab === "assets" && (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto shadow-sm">
          {previewError ? (
            <p className="p-6 text-sm text-destructive">{(previewError as Error).message}</p>
          ) : loadingPreview && !preview ? (
            <p className="p-8 text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading assets…</p>
          ) : !preview || preview.rows.length === 0 ? (
            <Empty icon={ListChecks} title="No depreciation-tagged assets" text="This project has no assets tagged for depreciation yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className={`${th} text-left`}>FA Item Code</th>
                  <th className={`${th} text-left`}>Item</th>
                  <th className={`${th} text-left`}>Method / Rate</th>
                  <th className={`${th} text-right`}>Cost</th>
                  <th className={`${th} text-right`}>{monthLabel(year, month)} Depreciation</th>
                  <th className={`${th} text-right`}>Book Value After</th>
                  <th className={`${th} text-left`}>Status</th>
                  <th className={`${th} text-left`}>Voucher / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {preview.rows.map((r) => (
                  <tr key={r.assetId} className={`hover:bg-muted/30 transition-colors ${r.state === "notEligible" ? "opacity-70" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-yellow-700 dark:text-yellow-400">{r.faItemCode}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{r.assetName || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.method ? <span className="inline-flex items-center gap-1.5"><span className="rounded-md bg-muted px-1.5 py-0.5 font-medium">{r.method}</span>{r.ratePct ?? 0}%</span> : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(r.purchaseCost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{r.state === "notEligible" ? "—" : fmtAmt(r.amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.state === "notEligible" ? "—" : fmtAmt(r.closingBookValue)}</td>
                    <td className="px-4 py-3">{statusBadge(r)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[320px]">
                      {failedMsg.get(r.assetId) ? <span className="text-destructive">{failedMsg.get(r.assetId)}</span>
                        : r.state === "posted" ? <><span className="font-mono text-foreground">{r.voucherNo}</span> · {fmtDateTime(r.postedAt)}</>
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
        <div className="rounded-2xl border border-border bg-card overflow-x-auto shadow-sm">
          {history.length === 0 ? (
            <Empty icon={History} title="Nothing posted yet" text="No depreciation has been posted for this project yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className={`${th} text-left`}>Project</th>
                  <th className={`${th} text-left`}>Month</th>
                  <th className={`${th} text-left`}>FA Item Code</th>
                  <th className={`${th} text-right`}>Depreciation</th>
                  <th className={`${th} text-right`}>Accumulated</th>
                  <th className={`${th} text-right`}>Book Value</th>
                  <th className={`${th} text-left`}>Posting Date</th>
                  <th className={`${th} text-left`}>Voucher</th>
                  <th className={`${th} text-left`}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {history.map((h) => (
                  <tr key={h.EntryId} className={`hover:bg-muted/30 transition-colors ${h.PostingStatus === "Reversed" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">{h.ProjectName || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium">{monthLabel(h.PeriodYear, h.PeriodMonth)}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-yellow-700 dark:text-yellow-400">{h.FAItemCode || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtAmt(h.DepreciationAmount)}</td>
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
        <div className="rounded-2xl border border-border bg-card overflow-x-auto shadow-sm">
          {runs.length === 0 ? (
            <Empty icon={Clock3} title="No runs yet" text="Generate hasn't been run for this project yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className={`${th} text-left`}>Run At</th>
                  <th className={`${th} text-left`}>Month</th>
                  <th className={`${th} text-right`}>Newly Generated</th>
                  <th className={`${th} text-right`}>Already Posted</th>
                  <th className={`${th} text-right`}>Not Due</th>
                  <th className={`${th} text-right`}>Failed</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-left`}>By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {runs.map((r) => (
                  <tr key={r.RunId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{fmtDateTime(r.StartedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium">{monthLabel(r.PeriodYear, r.PeriodMonth)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.Generated ? <span className="font-semibold text-sky-600 dark:text-sky-400">{r.Generated}</span> : 0}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.AlreadyPosted}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.Skipped}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.Failed ? <span className="font-semibold text-destructive">{r.Failed}</span> : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtAmt(r.TotalAmount)}</td>
                    <td className="px-4 py-3 text-xs">{r.RunBy || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Same confirmation as before (was window.confirm) — Generate only runs on Confirm. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate {monthLabel(year, month)} depreciation?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-semibold text-foreground">{preview?.counts.pending ?? 0}</span> asset{preview?.counts.pending === 1 ? "" : "s"} will be posted
                  {projectLabel ? <> for <span className="font-semibold text-foreground">{projectLabel}</span></> : null} — ₹{fmtAmt(dueAmount)} in total.
                </p>
                {!!preview?.counts.posted && <p>{preview.counts.posted} already-posted asset(s) will be skipped.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => generate.mutate()}>Generate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassShell>
  );
}
