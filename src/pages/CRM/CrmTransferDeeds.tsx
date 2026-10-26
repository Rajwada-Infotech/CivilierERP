import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RefreshCw } from "lucide-react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { KEY_LINE, RULE, RULE_SOFT } from "./customers/config";
import { TransferDeedDetail } from "./CrmTransferDeed";

// Transfer Deeds — the legal chain of every resale (deed of assignment) and
// buy-back (cancellation deed), one page laid out like Sale Deed: the deeds on
// the left, the chosen deed on the right with its stage stepper and its tabs
// (Overview, Documents, Legal & Approval, Stamp Duty, Registry, History).
// Stamp duty and registry are stages of the deed — tabs here, not pages of
// their own. A case opens its deed at its deed step; ?id= opens one directly.

const STATUS: Record<string, string> = {
  Draft: "Papers", UnderReview: "Legal Head", LegalApproved: "To the parties", WithParties: "With the parties",
  PartiesApproved: "Signing date", DateApproved: "Stamp duty", Executed: "Registry", Registered: "Registered", Cancelled: "Cancelled",
};
const tone = (s: string): "done" | "waiting" | "stopped" => (s === "Registered" ? "done" : s === "Cancelled" ? "stopped" : "waiting");

type Filter = "all" | "open" | "registered" | "cancelled";

const CrmTransferDeeds: React.FC = () => {
  const rights = usePageRights("crm-transfer-deeds");
  const [sp, setSp] = useSearchParams();
  const selected = sp.get("id") ? Number(sp.get("id")) : null;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { data = [], isLoading, isError, error, isFetching, refetch } = useQuery<any[]>({
    queryKey: ["crm-transfer-deeds"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/crm/transfer-deeds");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load");
      return r.json();
    },
  });
  const groups = useMemo(() => ({
    all: data,
    open: data.filter((d) => !["Registered", "Cancelled"].includes(d.Status)),
    registered: data.filter((d) => d.Status === "Registered"),
    cancelled: data.filter((d) => d.Status === "Cancelled"),
  }), [data]);
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    const rows = groups[filter];
    return t ? rows.filter((d) => [d.DeedNo, d.Property, d.BookingNo, d.SellerName, d.BuyerName].some((v) => String(v || "").toLowerCase().includes(t))) : rows;
  }, [groups, filter, search]);
  const pick = (id: number) => setSp((p) => { p.set("id", String(id)); p.delete("tab"); return p; }, { replace: true });

  const figures: { label: string; value: number; note: string; f: Filter }[] = [
    { label: "Transfer deeds", value: groups.all.length, note: "Assignment and cancellation", f: "all" },
    { label: "In progress", value: groups.open.length, note: "Papers to registry", f: "open" },
    { label: "Registered", value: groups.registered.length, note: "At the Sub-Registrar", f: "registered" },
    { label: "Cancelled", value: groups.cancelled.length, note: "Stopped with their case", f: "cancelled" },
  ];

  return (
    <>
      <Breadcrumbs items={["CRM", "Resale", "Transfer Deeds"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Resale"
        title="Transfer Deeds"
        subtitle="Deeds of assignment (resale: seller, buyer and us) and cancellation deeds (buy-back: seller and us), from the papers through legal approval, the parties, signing date and stamp duty to registration."
        action={<button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>}
      >
        <div className="space-y-4">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => setFilter(x.f)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
            <aside className="bg-card flex flex-col min-h-0" style={{ border: RULE }}>
              <div className="p-3 space-y-2" style={{ borderBottom: RULE }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Deed, property, party…"
                  className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}
                  className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-2.5 text-xs text-foreground outline-none">
                  <option value="all">All deeds ({groups.all.length})</option>
                  <option value="open">In progress ({groups.open.length})</option>
                  <option value="registered">Registered ({groups.registered.length})</option>
                  <option value="cancelled">Cancelled ({groups.cancelled.length})</option>
                </select>
              </div>
              {isError ? <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message}</p>
                : isLoading ? <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
                : !list.length ? <p className="p-4 text-center text-sm text-muted-foreground">{data.length ? "No deed matches." : "No transfer deeds yet — a resale or buy-back case opens one at its deed step."}</p>
                : (
                  <ul className="max-h-[70vh] overflow-y-auto thin-scroll">
                    {list.map((d) => {
                      const on = selected === d.Id;
                      return (
                        <li key={d.Id}>
                          <button onClick={() => pick(d.Id)} className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-foreground text-card" : "hover:bg-primary/5"}`} style={{ borderBottom: RULE_SOFT }}>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold leading-tight truncate">{d.SellerName}<span className="font-normal opacity-70"> → {d.DeedType === "Assignment" ? d.BuyerName : "us"}</span></span>
                              <span className={on ? "[&_*]:!text-card" : ""}><SheetMark text={STATUS[d.Status] || d.Status} tone={tone(d.Status)} /></span>
                            </div>
                            <div className={`mt-1 text-[0.6875rem] tabular-nums truncate ${on ? "opacity-80" : "text-muted-foreground"}`}>{d.DeedNo} · {d.Property}</div>
                            <div className={`mt-0.5 text-[0.6875rem] truncate ${on ? "opacity-80" : "text-muted-foreground"}`}>
                              {d.DeedType === "Assignment" ? "Deed of assignment" : "Cancellation deed"} · papers <span className="tabular-nums">{d.DocsVerified}/{d.DocsRequired}</span>{d.LegalExecutiveName ? ` · ${d.LegalExecutiveName}` : " · no legal executive"}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </aside>
            <main className="min-w-0">
              {selected ? <TransferDeedDetail key={selected} id={selected} canEdit={rights.canEdit} initialTab={(sp.get("tab") as any) || undefined} />
                : <div className="bg-card p-10 text-center text-sm text-muted-foreground" style={{ border: RULE }}>Choose a deed to work on it.</div>}
            </main>
          </div>
        </div>
      </SheetShell>
    </>
  );
};

export default CrmTransferDeeds;
