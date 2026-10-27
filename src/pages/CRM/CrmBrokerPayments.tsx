import { CrmStatus } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";
import { API, BrokerageMark, fmt } from "./brokerage/config";

// Still fetched in full — the pending / with Finance / paid totals are worked out over the whole set (as on
// Demands); company / project / block narrow it on the server. Same endpoint as Brokerage, without ?page=.
async function fetchBrokerages(cpb: CrmCompanyProjectBlockValue): Promise<any[]> {
  const params = new URLSearchParams();
  if (cpb.companyId) params.set("companyId", cpb.companyId);
  if (cpb.projectId) params.set("projectId", cpb.projectId);
  if (cpb.blockId) params.set("blockId", cpb.blockId);
  const r = await fetchWithAuth(`${API}${params.toString() ? `?${params}` : ""}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `Could not load the broker records (${r.status})`);
  return Array.isArray(body) ? body : [];
}

const net = (r: any) => Number((r.NetPayable ?? r.ComputedAmount) || 0);
// Approved but with no Finance payment raised: the hand-off failed and can be retried.
const handoffFailed = (r: any) => r.Status === CrmStatus.APPROVED && !r.FinancePaymentId;
const TABS = [
  { k: "", l: "All" },
  { k: CrmStatus.PENDING, l: "Pending approval" },
  { k: CrmStatus.APPROVED, l: "With Finance" },
  { k: CrmStatus.PAID, l: "Paid" },
  { k: "failed", l: "Hand-off failed" },
];

const CrmBrokerPayments: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rights = usePageRights("crm-brokerage");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [retrying, setRetrying] = useState<number | null>(null);

  const { data: records = [], isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-broker-payments", cpb],
    queryFn: () => fetchBrokerages(cpb),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? records.filter((r: any) => [r.ApplicantName, r.BrokerName, r.BookingNo, r.BrokerFirm].some((v) => String(v || "").toLowerCase().includes(q))) : records;
  }, [records, search]);
  const inTab = (r: any, k: string) => !k || (k === "failed" ? handoffFailed(r) : r.Status === k && !r.IsLocked);
  const shown = searched.filter((r: any) => inTab(r, tab));
  const totalOf = (k: string) => searched.filter((r: any) => inTab(r, k)).reduce((s: number, r: any) => s + net(r), 0);
  const countOf = (k: string) => searched.filter((r: any) => inTab(r, k)).length;

  // The Finance hand-off can fail after approval (the approval itself stays); this raises the payment again.
  const retry = async (r: any) => {
    setRetrying(r.Id);
    try {
      const res = await fetchWithAuth(`${API}/${r.Id}/retry-finance-handoff`, { method: "PUT" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Retry failed");
      toast.success(`Sent to Finance${d.financePayment?.DocNo ? ` — ${d.financePayment.DocNo}` : ""}`);
      qc.invalidateQueries({ queryKey: ["crm-broker-payments"] });
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRetrying(null);
    }
  };

  const figures = [
    { label: "Pending approval", value: fmt(totalOf(CrmStatus.PENDING)), note: `${countOf(CrmStatus.PENDING)} to approve`, k: CrmStatus.PENDING as string },
    { label: "With Finance", value: fmt(totalOf(CrmStatus.APPROVED)), note: `${countOf(CrmStatus.APPROVED)} being paid`, k: CrmStatus.APPROVED as string },
    { label: "Paid", value: fmt(totalOf(CrmStatus.PAID)), note: `${countOf(CrmStatus.PAID)} paid out`, k: CrmStatus.PAID as string },
    { label: "Hand-off failed", value: String(countOf("failed")), note: "Approved, not yet in Finance", k: "failed", red: countOf("failed") > 0 },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Broker Payments"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Broker Payments"
        subtitle="Brokerage approved on the Brokerage page goes to Finance as a payment; when Finance pays it, the status here follows."
        action={
          <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => setTab(x.k)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {TABS.map((t) => (
                  <button key={t.k || "all"} onClick={() => setTab(t.k)} style={{ borderRight: RULE_SOFT }}
                    className={`${tabClass(tab === t.k)} ${t.k === "failed" && countOf("failed") > 0 && tab !== t.k ? "!text-destructive" : ""}`}>
                    {t.l} <span className="tabular-nums">{countOf(t.k)}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2.5 flex-wrap items-center">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search broker, customer, booking…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Booking</th><th className={th}>Broker</th><th className={`${th} !text-right`}>Gross · TDS · net</th>
                    <th className={th}>Brokerage</th><th className={th}>Finance payment</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={6} className={`${td} text-center text-destructive`}>
                      {(error as Error)?.message} <button onClick={() => refetch()} className="ml-2 underline underline-offset-2">Retry</button>
                    </td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : shown.length === 0 ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>{records.length ? "No broker record matches." : "No brokerage recorded yet."}</td></tr>
                  ) : shown.map((r: any) => {
                    const gross = Number(r.ComputedAmount || 0);
                    const tds = Number(r.TDSAmount || 0);
                    const failed = handoffFailed(r);
                    return (
                      <tr key={r.Id} className="align-top" style={{ borderBottom: RULE_SOFT, boxShadow: failed ? "inset 3px 0 0 hsl(var(--destructive))" : undefined }}>
                        <td className={td}>
                          <div className="font-heading text-xs font-semibold tabular-nums">{r.BookingNo}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground truncate max-w-[180px]"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} /></div>
                        </td>
                        <td className={td}>
                          <div className="text-xs font-medium">{r.BrokerName}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
                            {r.BrokerFirm ? `${r.BrokerFirm} · ` : ""}{r.RateType === "Percentage" ? `${r.RateValue}%` : fmt(r.RateValue)}
                          </div>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          <div className="font-heading text-xs text-muted-foreground">{fmt(gross)}</div>
                          {tds > 0 && <div className="mt-1 text-[0.6875rem] text-muted-foreground">− TDS {fmt(tds)}</div>}
                          <div className="mt-1 font-heading font-semibold">{fmt(net(r))}</div>
                        </td>
                        <td className={td}><BrokerageMark r={r} /></td>
                        <td className={td}>
                          {r.Status === CrmStatus.PENDING ? (
                            <span className="text-xs text-muted-foreground">Awaiting approval</span>
                          ) : r.Status === CrmStatus.PAID ? (
                            <>
                              <SheetMark text="Paid" tone="done" />
                              {Number(r.TotalPaid) > 0 && <div className="mt-1 font-heading text-xs tabular-nums">{fmt(r.TotalPaid)}</div>}
                            </>
                          ) : failed ? (
                            <span className="text-xs font-semibold text-destructive">Hand-off to Finance failed</span>
                          ) : (
                            <button onClick={() => navigate(`/payments?view=${r.FinancePaymentId}`)} className={`${KEY_LINE} h-8 px-3`}>
                              <span className="tabular-nums">{r.FinancePaymentDocNo || `#${r.FinancePaymentId}`}</span>
                              {r.FinancePaymentStatus ? <span className="font-normal normal-case tracking-normal text-muted-foreground">· {r.FinancePaymentStatus}</span> : null}
                              <ExternalLink size={11} />
                            </button>
                          )}
                        </td>
                        <td className={`${td} text-right`}>
                          <div className="inline-flex items-center gap-2">
                            {failed && rights.canEdit && (
                              <button onClick={() => retry(r)} disabled={retrying === r.Id} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}>
                                <RotateCcw size={11} /> {retrying === r.Id ? "Sending…" : "Retry hand-off"}
                              </button>
                            )}
                            <button onClick={() => navigate(`/crm/brokerage?view=${r.Id}`)} className={`${KEY_LINE} h-8 px-3`}>{r.Status === CrmStatus.PENDING ? "Review" : "View"}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SheetShell>
    </>
  );
};

export default CrmBrokerPayments;
