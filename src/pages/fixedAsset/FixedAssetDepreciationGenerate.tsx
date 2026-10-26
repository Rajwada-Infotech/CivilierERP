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
  generateDepreciation, getGeneratePreview, getGenerateRuns, getPostingHistory,
  type GenerateOutcome, type GenerateResult,
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
  const [tab, setTab] = useState<Tab>("assets");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // What the last Generate click did for the selected project + month (to show "generated now").
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null);

  const [year, month] = useMemo(() => {
    const [y, m] = monthValue.split("-").map(Number);
    return [y || 0, m || 0] as const;
  }, [monthValue]);

  useEffect(() => { setLastResult(null); }, [projectId, monthValue]);

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
            <div className="p-5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_14rem_auto] gap-5 items-end">
              <Field label="Project" required>
                <SearchableNativeSelect className={INP} value={projectId} onChange={(e) => setProjectId(e.target.value)} searchPlaceholder="Search project…">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </SearchableNativeSelect>
              </Field>
              <Field label="Month" required>
                <MonthInput className={INP} value={monthValue} max={currentMonth()} clearable={false} onChange={(e) => setMonthValue(e.target.value)} />
              </Field>
              {rights.canCreate && (
                <button
                  onClick={() => preview && setConfirmOpen(true)}
                  disabled={!ready || !preview || due === 0 || generate.isPending}
                  title={preview && due === 0 ? "Nothing is due for this project and month" : "Generate depreciation"}
                  className={`${KEY_INK} h-10 px-5 w-full md:w-auto`}
                >
                  {generate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Generate{due > 0 ? ` (${due})` : ""}
                </button>
              )}
            </div>

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
          month={monthName}
          project={projectLabel}
          due={due}
          posted={preview?.counts.posted ?? 0}
          amount={dueAmount}
          onConfirm={() => generate.mutate()}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
