// Depreciation run: post a month's depreciation for every depreciation-tagged asset of a project. Parts under
// ./depreciationRun: columns (assets, posting history, run log) · GenerateConfirm · config. Sheet styles from ./record/config.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable } from "@/components/ui/DataTable";
import { MonthInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  generateDepreciation, generateDepreciationRange, getGeneratePreview, getGenerateRuns, getPostingHistory,
  type GenerateOutcome, type GenerateRangeResult, type GenerateResult,
} from "@/api/fixedAssetDepreciationGenerateApi";
import { Field, INP, Mark, KEY_INK, KEY_LINE, LBL, RULE, fmt } from "./record/config";
import { currentMonth, fmtAmt, lastClosedMonth, monthLabel, monthMark } from "./depreciationRun/config";
import { HISTORY_COLUMNS, RUN_COLUMNS, assetColumns } from "./depreciationRun/columns";
import { GenerateConfirm } from "./depreciationRun/GenerateConfirm";

type Tab = "assets" | "history" | "log";
const TABS: { k: Tab; label: string }[] = [
  { k: "assets", label: "Assets" },
  { k: "history", label: "Posting history" },
  { k: "log", label: "Run log" },
];

export default function FixedAssetDepreciationGenerate() {
  const rights = usePageRights("fixed-asset-depreciation-generate");
  const qc = useQueryClient();

  const [projectId, setProjectId] = useState("");
  const [monthValue, setMonthValue] = useState(lastClosedMonth());
  // Custom month range: run every month from `fromValue` to `toValue` in one go (oldest first).
  const [rangeMode, setRangeMode] = useState(false);
  const [fromValue, setFromValue] = useState(lastClosedMonth());
  const [toValue, setToValue] = useState(lastClosedMonth());
  const [rangeResult, setRangeResult] = useState<GenerateRangeResult | null>(null);
  const [tab, setTab] = useState<Tab>("assets");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // What the last Generate click did for the selected project + month (to show "generated now").
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null);

  // In range mode the asset list shows the range's last month; the run itself covers the whole range.
  const shownMonthValue = rangeMode ? toValue : monthValue;
  const [year, month] = useMemo(() => {
    const [y, m] = shownMonthValue.split("-").map(Number);
    return [y || 0, m || 0] as const;
  }, [shownMonthValue]);
  const rangeMonths = useMemo(() => {
    const [fy, fm] = fromValue.split("-").map(Number);
    const [ty, tm] = toValue.split("-").map(Number);
    if (!fy || !fm || !ty || !tm) return 0;
    return (ty * 12 + tm) - (fy * 12 + fm) + 1;
  }, [fromValue, toValue]);
  const rangeError = !rangeMode ? null : rangeMonths < 1 ? "The 'To' month can't be before the 'From' month." : rangeMonths > 36 ? "A range can cover at most 36 months." : null;

  useEffect(() => { setLastResult(null); setRangeResult(null); }, [projectId, monthValue, fromValue, toValue, rangeMode]);

  const { data: projects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });

  const pid = Number(projectId) || 0;
  const ready = pid > 0 && year > 0 && month > 0;

  const { data: preview, isFetching: loadingPreview, error: previewError, refetch } = useQuery({
    queryKey: ["fa-dep-generate-preview", pid, year, month],
    queryFn: () => getGeneratePreview(pid, year, month),
    enabled: ready,
  });
  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ["fa-dep-generate-history", pid],
    queryFn: () => getPostingHistory(pid),
    enabled: pid > 0 && tab === "history",
  });
  const { data: runs = [], isLoading: loadingRuns } = useQuery({
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
      ["fa-dep-generate-preview", "fa-dep-generate-history", "fa-dep-generate-runs", "fixed-asset-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runRange = useMutation({
    mutationFn: () => {
      const [fy, fm] = fromValue.split("-").map(Number);
      const [ty, tm] = toValue.split("-").map(Number);
      return generateDepreciationRange(pid, { year: fy, month: fm }, { year: ty, month: tm });
    },
    onSuccess: (res) => {
      setRangeResult(res);
      const c = res.counts;
      if (res.stoppedAt) toast.error(`Stopped at ${monthLabel(res.stoppedAt.year, res.stoppedAt.month)}: ${res.stoppedAt.message}`);
      if (c.generated > 0) toast.success(`${c.generated} posting${c.generated === 1 ? "" : "s"} generated across ${res.months.length} month${res.months.length === 1 ? "" : "s"} — ₹${fmtAmt(res.totalAmount)}`);
      else if (!res.stoppedAt) toast.info(`Nothing new to generate — ${c.alreadyPosted} already posted${c.skipped ? `, ${c.skipped} not due` : ""}`);
      if (c.failed > 0) toast.warning(`${c.failed} posting(s) failed — see the month list`);
      ["fa-dep-generate-preview", "fa-dep-generate-history", "fa-dep-generate-runs", "fixed-asset-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
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

  // Display-only: total of what Generate would post now.
  const dueAmount = useMemo(
    () => (preview?.rows ?? []).filter((r) => r.state === "pending").reduce((t, r) => t + (Number(r.amount) || 0), 0),
    [preview],
  );
  const projectLabel = projects.find((p) => String(p.id) === projectId)?.label;
  const monthName = year && month ? monthLabel(year, month) : "";
  const fromParts = fromValue.split("-").map(Number);
  const rangeLabel = rangeMode && rangeMonths > 1 && fromParts[0] && fromParts[1] ? `${monthLabel(fromParts[0], fromParts[1])} – ${monthName}` : monthName;
  const working = generate.isPending || runRange.isPending;
  const due = preview?.counts.pending ?? 0;
  const mark = preview && monthMark(preview.monthStatus);

  const stats = preview
    ? [
        { label: "Tagged assets", value: fmt(preview.counts.total), note: preview.counts.notEligible ? `${fmt(preview.counts.notEligible)} not eligible this month` : "all eligible this month" },
        { label: "Already posted", value: fmt(preview.counts.posted), note: `for ${monthName}` },
        { label: "Due now", value: fmt(due), note: due ? "Generate posts these" : "nothing left to post" },
        { label: "Amount due", value: `₹${fmtAmt(dueAmount)}`, note: "depreciation to post" },
      ]
    : [];

  const assetCols = useMemo(() => assetColumns(monthName, outcomeOf, failedMsg), [monthName, outcomeOf, failedMsg]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Depreciation Run"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title="Depreciation run"
        subtitle="Pick a project and a month that has closed; every depreciation-tagged asset under it is listed with what Generate will post."
        action={
          ready ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={loadingPreview} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={loadingPreview ? "animate-spin" : ""} />
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {/* ── The run: project, month, Generate ── */}
          <div className="bg-card" style={{ border: RULE }}>
            <div className={`p-5 grid grid-cols-1 gap-5 items-end ${rangeMode ? "md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]" : "md:grid-cols-[minmax(0,1fr)_14rem_auto]"}`}>
              <Field label="Project" required>
                <SearchableNativeSelect className={INP} value={projectId} onChange={(e) => setProjectId(e.target.value)} searchPlaceholder="Search project…">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </SearchableNativeSelect>
              </Field>
              {rangeMode ? (
                <>
                  <Field label="From month" required>
                    <MonthInput className={INP} value={fromValue} max={currentMonth()} clearable={false} onChange={(e) => setFromValue(e.target.value)} />
                  </Field>
                  <Field label="To month" required>
                    <MonthInput className={INP} value={toValue} max={currentMonth()} clearable={false} onChange={(e) => setToValue(e.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label="Month" required>
                  <MonthInput className={INP} value={monthValue} max={currentMonth()} clearable={false} onChange={(e) => setMonthValue(e.target.value)} />
                </Field>
              )}
              {rights.canCreate && (
                <button
                  onClick={() => (rangeMode ? setConfirmOpen(true) : preview && setConfirmOpen(true))}
                  disabled={rangeMode ? !ready || !!rangeError || working : !ready || !preview || due === 0 || working}
                  title={rangeMode ? "Run depreciation for every month in the range" : preview && due === 0 ? "Nothing is due for this project and month" : "Generate depreciation"}
                  className={`${KEY_INK} h-10 px-5 w-full md:w-auto`}
                >
                  {working ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  {rangeMode ? `Run${rangeMonths > 1 ? ` (${rangeMonths} months)` : ""}` : `Generate${due > 0 ? ` (${due})` : ""}`}
                </button>
              )}
            </div>
            <div className="px-5 pb-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                <input type="checkbox" checked={rangeMode} onChange={(e) => setRangeMode(e.target.checked)} />
                Custom month range <span className="text-muted-foreground">— run several months at once</span>
              </label>
              {rangeError && <span className="text-xs text-destructive">{rangeError}</span>}
            </div>

            {rangeResult && (
              <div className="px-5 py-4" style={{ borderTop: RULE }}>
                <p className={LBL}>Range result · {rangeResult.counts.generated} generated · {rangeResult.counts.alreadyPosted} already posted · ₹{fmtAmt(rangeResult.totalAmount)}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground"><th className="py-1 pr-4">Month</th><th className="pr-4">Generated</th><th className="pr-4">Already posted</th><th className="pr-4">Not due</th><th className="pr-4">Failed</th><th className="text-right">Amount</th></tr>
                    </thead>
                    <tbody>
                      {rangeResult.months.map((m) => (
                        <tr key={`${m.year}-${m.month}`} style={{ borderTop: "1px solid hsl(var(--foreground) / 0.12)" }}>
                          <td className="py-1 pr-4 font-semibold text-foreground">{monthLabel(m.year, m.month)}</td>
                          {m.error ? (
                            <td colSpan={5} className="text-destructive">{m.error}</td>
                          ) : (
                            <>
                              <td className="pr-4">{m.counts?.generated}</td>
                              <td className="pr-4">{m.counts?.alreadyPosted}</td>
                              <td className="pr-4">{m.counts?.skipped}</td>
                              <td className={`pr-4 ${m.counts?.failed ? "text-destructive font-semibold" : ""}`}>{m.counts?.failed}</td>
                              <td className="text-right">₹{fmtAmt(m.totalAmount ?? 0)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ready && preview && (
              <>
                <div className="px-5 py-3 flex flex-wrap items-center gap-3" style={{ borderTop: RULE }}>
                  <span className="font-heading text-sm font-bold text-foreground">{monthName}</span>
                  {projectLabel && <span className="text-xs text-muted-foreground truncate">{projectLabel}</span>}
                  {mark && <Mark text={mark.text} tone={mark.tone} />}
                </div>
                <div className="statrow four" style={{ padding: "16px 20px 18px", borderTop: "1px solid hsl(var(--foreground) / 0.2)" }}>
                  {stats.map((x) => (
                    <div key={x.label}>
                      <p className="label">{x.label}</p>
                      <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
                      <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Schedules ── */}
          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <span className="inline-flex h-9 border border-foreground overflow-x-auto max-w-full" role="group" aria-label="Show">
                {TABS.map((t) => (
                  <button key={t.k} onClick={() => setTab(t.k)} aria-pressed={tab === t.k}
                    className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 shrink-0 transition-colors ${tab === t.k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                    {t.label}
                  </button>
                ))}
              </span>
              {tab !== "assets" && pid > 0 && <span className={LBL}>All months · {projectLabel}</span>}
            </div>

            {!ready ? (
              <div className="px-6 py-14 text-center">
                <p className="font-heading text-sm font-bold text-foreground">Pick a project and a month</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Every depreciation-tagged asset of the project is listed here with what Generate will post for that month.
                </p>
              </div>
            ) : tab === "assets" ? (
              previewError ? (
                <p className="p-6 text-sm text-destructive">{(previewError as Error).message}</p>
              ) : (
                <DataTable
                  data={preview?.rows ?? []}
                  columns={assetCols}
                  loading={loadingPreview && !preview}
                  searchable
                  searchPlaceholder="Search asset or FA Item Code…"
                  paginated
                  getRowId={(r) => String(r.assetId)}
                  rowClassName={(row) => (row.original.state === "notEligible" ? "opacity-70" : failedMsg.has(row.original.assetId) ? "bg-destructive/[0.04]" : "")}
                  emptyMessage="This project has no assets tagged for depreciation yet."
                />
              )
            ) : tab === "history" ? (
              <DataTable
                data={history}
                columns={HISTORY_COLUMNS}
                loading={loadingHistory}
                searchable
                searchPlaceholder="Search asset, FA Item Code, voucher…"
                paginated
                getRowId={(h) => String(h.EntryId)}
                rowClassName={(row) => (row.original.PostingStatus === "Reversed" ? "opacity-60" : "")}
                emptyMessage="No depreciation has been posted for this project yet."
              />
            ) : (
              <DataTable
                data={runs}
                columns={RUN_COLUMNS}
                loading={loadingRuns}
                paginated
                getRowId={(r) => String(r.RunId)}
                emptyMessage="Generate hasn't been run for this project yet."
              />
            )}
          </div>
        </div>
      </SheetShell>

      {confirmOpen && (
        <GenerateConfirm
          month={rangeLabel}
          project={projectLabel}
          due={due}
          posted={preview?.counts.posted ?? 0}
          amount={dueAmount}
          range={rangeMode}
          onConfirm={() => (rangeMode ? runRange.mutate() : generate.mutate())}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
