import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search } from "lucide-react";
import { TransferDeedDetail } from "./CrmTransferDeed";

// Transfer Deeds — the legal chain of every resale (deed of assignment) and
// buy-back (cancellation deed), one page laid out like Sale Deed: the deeds on
// the left, the chosen deed on the right with its stage stepper and its tabs
// (Overview, Documents, Legal & Approval, Stamp Duty, Registry, History).
// Stamp duty and registry are stages of the deed — tabs here, not pages of
// their own. A case opens its deed at its deed step; ?id= opens one directly.

const STATUS: Record<string, [string, string]> = {
  Draft: ["Papers", "bg-muted text-muted-foreground border-border"],
  UnderReview: ["Legal Head", "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"],
  LegalApproved: ["To the parties", "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900"],
  WithParties: ["With the parties", "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"],
  PartiesApproved: ["Signing date", "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900"],
  DateApproved: ["Stamp duty", "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900"],
  Executed: ["Registry", "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900"],
  Registered: ["Registered", "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900"],
  Cancelled: ["Cancelled", "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"],
};

const CrmTransferDeeds: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-transfer-deeds");
  const [sp, setSp] = useSearchParams();
  const selected = sp.get("id") ? Number(sp.get("id")) : null;
  const [search, setSearch] = useState("");
  const { data = [], isLoading, dataUpdatedAt, isFetching } = useQuery<any[]>({
    queryKey: ["crm-transfer-deeds"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/crm/transfer-deeds");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load");
      return r.json();
    },
  });
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? data.filter((d) => [d.DeedNo, d.Property, d.BookingNo, d.SellerName, d.BuyerName].some((v) => String(v || "").toLowerCase().includes(t))) : data;
  }, [data, search]);
  const pick = (id: number) => setSp((p) => { p.set("id", String(id)); p.delete("tab"); return p; }, { replace: true });

  return (
    <CrmShell title="Transfer Deeds" subtitle="Deeds of assignment (resale) and cancellation deeds (buy-back)">
      <Breadcrumbs items={["CRM", "Resale & Buy-back", "Transfer Deeds"]} />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Deed, property, party…"
                className="w-full h-9 pl-8 pr-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["crm-transfer-deeds"] })} />
          </div>
          {isLoading ? <p className="text-xs text-muted-foreground p-3">Loading…</p>
            : !list.length ? <p className="text-xs text-muted-foreground p-3 rounded-lg border border-dashed border-border">No transfer deeds yet — a resale or buy-back case opens one at its deed step.</p>
            : (
              <ul className="space-y-2">
                {list.map((d) => {
                  const s = STATUS[d.Status] || [d.Status, ""];
                  return (
                    <li key={d.Id}>
                      <button onClick={() => pick(d.Id)} className={`w-full text-left rounded-xl border p-3 transition-colors ${selected === d.Id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold truncate">{d.SellerName}<span className="font-normal opacity-60"> → {d.DeedType === "Assignment" ? d.BuyerName : "us"}</span></span>
                          <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${s[1]}`}>{s[0]}</span>
                        </div>
                        <div className="text-[0.6875rem] font-mono text-muted-foreground mt-1">{d.DeedNo} · {d.Property}</div>
                        <div className="text-[0.6875rem] text-muted-foreground mt-0.5">{d.DeedType === "Assignment" ? "Deed of assignment" : "Cancellation deed"} · papers {d.DocsVerified}/{d.DocsRequired}{d.LegalExecutiveName ? ` · ${d.LegalExecutiveName}` : " · no legal executive"}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </aside>
        <main className="min-w-0">
          {selected ? <TransferDeedDetail key={selected} id={selected} canEdit={rights.canEdit} initialTab={(sp.get("tab") as any) || undefined} />
            : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Choose a deed to work on it.</div>}
        </main>
      </div>
    </CrmShell>
  );
};

export default CrmTransferDeeds;
