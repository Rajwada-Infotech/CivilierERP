import { useEffect, useMemo, useRef, useState } from "react";
import { DueBadge, dueRow, dueLevel, DUE_BG } from "@/components/legal/DueBadge";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pager } from "@/components/legal/usePaged";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SearchStatus } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { useProjectScope } from "@/components/legal/ProjectPicker";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import { LegalMasterTable } from "@/pages/legal/LegalMasterPage";
import { legalMasterByKey } from "@/pages/legal/legalMasters";
import { RecordMapping } from "@/components/legal/RecordMapping";
import { ParcelsView } from "@/components/legal/LandIntelligence";
import { LandRecordsSummaryView } from "@/components/legal/LandRecordsSummary";
import { uploadLegalFile } from "@/api/legalMastersApi";
import {
  addEnquirySearch, YEAR_STATUSES, SEARCH_METHODS,
  getSearchOptions, findEnquiries, findEnquiriesPage, getEnquirySearches, setOfficeOf, addYearResult, editYearResult, deleteYearResult, addYearRange,
  completeOffice, reopenOffice, addOffice, daysCounter, setOfficeFromYear, type YearStatus,
  type EnquiryHit, type OfficeSearch, type YearResult, type YearBody, type SearchOptions,
} from "@/api/legalEnquirySearchApi";

const field = "h-9 w-full border border-border bg-background px-2 text-sm";
const WAITING: string[] = ["Under Review", "Requested", "Certified Copy Requested", "Awaiting Office Response"];
const NO_ACCESS: string[] = ["Unable to Access", "Record Not Digitised"];
const small = "border border-border px-2 py-1 text-xs hover:bg-muted";
const TONE = { ok: "bg-emerald-600/10 text-emerald-700 border-emerald-600/40", warn: "bg-amber-500/15 text-amber-700 border-amber-500/50", over: "bg-destructive/10 text-destructive border-destructive/50" };
const thisYear = new Date().getFullYear();

/** Days left / overdue on a timeline; "Completed" once that search is done. */
function Counter({ due, done }: { due: string | null; done: boolean }) {
  if (done) return <span className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-[0.6875rem] font-semibold ${TONE.ok}`}>Completed</span>;
  const c = daysCounter(due);
  if (!c) return null;
  return <span className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums ${TONE[c.tone]}`}>{c.text}</span>;
}

/**
 * Deed Registry Search — a work queue.
 * Left: the project's enquiries (Pending first, overdue in red) with each one's office progress.
 * Right: the picked enquiry — one tab per registration office (Setup → Registration Office Types), each with its own
 * timeline, the office from the master, and a year grid (first year → this year): click a year to record it, or mark a
 * whole range as not found; then complete that office.
 */
export default function LandDeedSearchPage() {
  const rights = usePageRights("legal-land-enquiry");
  const navigate = useNavigate();
  // The project comes from the Legal header picker (top right); a search here can switch it.
  const { scope: projectId, setScope: setProjectId } = useProjectScope();
  const start = new URLSearchParams(window.location.search).get("q") ?? "";
  const [q, setQ] = useState(start);
  const [pickedId, setPickedId] = useState<number | null>(null);
  // ?view= from the dashboard report opens that portion: pending, overdue, ontime, done or all.
  const VIEWS = ["pending", "overdue", "ontime", "done", "all"] as const;
  type View = (typeof VIEWS)[number];
  const asked = new URLSearchParams(window.location.search).get("view") as View | null;
  const [tab, setTab] = useState<View>(asked && VIEWS.includes(asked) ? asked : start ? "all" : "pending");

  // One page (20) from the server, for the open view and what is typed; the view counts come as page totals.
  const [term, setTerm] = useState(q.trim());
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [term, tab, projectId]);
  const { data: pageData, isFetching, error } = useQuery({
    queryKey: ["legal-enq-find", projectId, term, tab, page],
    queryFn: () => findEnquiriesPage(projectId!, term, page, tab === "all" ? undefined : tab),
    enabled: !!projectId, placeholderData: keepPreviousData,
  });
  const countOf = (kind?: string) => ({
    queryKey: ["legal-enq-find", projectId, "", kind ?? "all", "count"], queryFn: () => findEnquiriesPage(projectId!, "", 1, kind, 1), enabled: !!projectId,
  });
  const pendingN = useQuery(countOf("pending")).data?.total ?? 0;
  const overdueN = useQuery(countOf("overdue")).data?.total ?? 0;
  const doneN = useQuery(countOf("done")).data?.total ?? 0;
  const allN = useQuery(countOf()).data?.total ?? 0;
  const isDone = (h: EnquiryHit) => !!h.LandId || h.EnquiryStatus === "Rejected" || h.OfficesDone >= h.OfficesTotal;
  const list = pageData?.items ?? [];
  const all = list; // the enquiries on this page
  const current = list.find((h) => h.EnquiryId === pickedId) ?? null;

  // Link values (?project, ?q, ?view, ?office from the dashboard / Land Enquiries) are used once; any choice made here
  // drops them from the address so a refresh or the next pick does not bring them back.
  const dropLink = () => { if (window.location.search) navigate("/legal/land/deed-search", { replace: true }); };
  // Switching the project by hand starts clean: no search text, no open enquiry, the Pending list.
  // The project changed in the header: start clean (no search text, no open enquiry, the Pending list) — unless the
  // change came from Search below, which picks the project of what it found.
  const fromSearch = useRef(false);
  const firstScope = useRef(projectId);
  useEffect(() => {
    if (firstScope.current === projectId) return;
    firstScope.current = projectId;
    if (fromSearch.current) { fromSearch.current = false; return; }
    setPickedId(null); setQ(""); setTab("pending"); dropLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const pick = (id: number) => { setPickedId(id); dropLink(); };
  // The work area is never empty: the first enquiry of the list opens by itself.
  useEffect(() => { if (!pickedId && !start && list.length) setPickedId(list[0].EnquiryId); }, [list, pickedId, start]);

  // Search across every project (enquiry no, Land ID, RS / LR Dag or Khatian): the project of what is found is opened
  // by itself — one project → that project; several → All projects; one enquiry → it is picked.
  const [finding, setFinding] = useState(false);
  const findEverywhere = async () => {
    const text = q.trim();
    if (!text) return;
    setFinding(true);
    try {
      const hits = await findEnquiries("all", text, "all");
      if (!hits.length) { toast.error(`No enquiry found for "${text}" in any project`); return; }
      const projects = [...new Set(hits.map((h) => h.ProjectId ?? 0))];
      const target = projects.length === 1 ? (projects[0] || "none") : "all";
      if (target !== projectId) fromSearch.current = true;
      setProjectId(target);
      setTab("all");
      setPickedId(hits.length === 1 ? hits[0].EnquiryId : null);
      dropLink();
      toast.success(hits.length === 1 ? `Found ${hits[0].EnquiryNo}${hits[0].ProjectName ? ` in ${hits[0].ProjectName}` : ""}`
        : `${hits.length} enquiries found${projects.length > 1 ? ` in ${projects.length} projects` : hits[0].ProjectName ? ` in ${hits[0].ProjectName}` : ""}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Search failed"); } finally { setFinding(false); }
  };
  useEffect(() => {
    if (!pickedId && start) { const m = all.find((h) => h.EnquiryNo === start); if (m) setPickedId(m.EnquiryId); }
  }, [all, pickedId, start]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", "Land Records Search"]} />
      <LegalShell stage="search" title="Land Records Search" subtitle="Check the government records of each enquiry plot before it goes further." icon={SearchStatus}>
        <ol className="mb-4 grid gap-px border border-border bg-border text-xs sm:grid-cols-4">
          {[["1", "Pick an enquiry", "from the list on the left (overdue ones first)"],
            ["2", "Search each source", "RS, LR, CS records and the registry offices — mark every year found / not found"],
            ["3", "Record & check", "enter the records found, link CS → RS → LR, note differences and claims"],
            ["4", "Legal review", "the legal officer reviews; when every mandatory source is complete the land can be converted"]].map(([n, t, d]) => (
            <li key={n} className="flex gap-2 bg-card px-3 py-2"><b className="flex h-5 w-5 shrink-0 items-center justify-center bg-foreground text-[0.625rem] text-background">{n}</b>
              <span><b className="block">{t}</b><span className="text-muted-foreground">{d}</span></span></li>
          ))}
        </ol>
        <div className="mb-4 flex flex-wrap items-center gap-3 border border-border bg-card px-4 py-3">
          <form className="flex min-w-[18rem] flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); findEverywhere(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enquiry no, Land ID, RS / LR Dag or Khatian, mouza — filters this list; Search looks in all projects"
              className="h-9 flex-1 border border-border bg-background px-3 text-sm" />
            <button disabled={finding || !q.trim()} className="h-9 border border-foreground bg-foreground px-4 text-sm font-semibold text-card disabled:opacity-40">{finding ? "Searching…" : "Search"}</button>
            {q && <button type="button" className="text-xs underline" onClick={() => { setQ(""); setPickedId(null); dropLink(); }}>Clear</button>}
          </form>
        </div>
        {projectId && (
          <div className="legal-cq"><div className="legal-split">
            {/* ── Queue ── */}
            <aside className="legal-queue border border-border bg-card">
              <div className="space-y-2 border-b border-border p-3">
                {term && <p className="text-xs text-muted-foreground">Filtered by “{q.trim()}” · {pageData?.total ?? 0} found</p>}
                <div className="grid grid-cols-3 border border-border text-[0.6875rem] font-semibold uppercase tracking-wider">
                  {([["pending", `Pending ${pendingN}`], ["done", `Completed ${doneN}`], ["all", `All ${allN}`]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)}
                      className={`px-2 py-1.5 ${tab === k ? "bg-foreground text-card" : k === "pending" && pendingN ? "bg-amber-500/15 text-amber-700" : "hover:bg-muted"}`}>{l}</button>
                  ))}
                </div>
                {overdueN > 0 && tab !== "overdue" && <button onClick={() => setTab("overdue")} className="text-left text-xs font-semibold text-destructive underline">{overdueN} enquir{overdueN > 1 ? "ies" : "y"} with an overdue office — show</button>}
                {(tab === "overdue" || tab === "ontime") && (
                  <p className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className={tab === "overdue" ? "text-destructive" : "text-sky-700"}>{tab === "overdue" ? "Showing: overdue only" : "Showing: pending, within time"}</span>
                    <button className="underline" onClick={() => setTab("pending")}>All pending</button>
                  </p>
                )}
              </div>
              {error && <p className="p-3 text-sm text-destructive">{(error as Error).message}</p>}
              <ul className="divide-y divide-border">
                {list.map((h) => {
                  const done = isDone(h);
                  const pct = h.OfficesTotal ? Math.round((h.OfficesDone / h.OfficesTotal) * 100) : 0;
                  return (
                    <li key={h.EnquiryId}>
                      <button onClick={() => pick(h.EnquiryId)}
                        className={`block w-full border-l-4 px-3 py-2.5 text-left hover:bg-muted/40 ${pickedId === h.EnquiryId ? "bg-primary/10" : ""} ${done ? "border-l-emerald-600" : h.DaysOver > 0 ? "border-l-destructive" : "border-l-amber-500"}`}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-semibold">{h.EnquiryNo}</span>
                          <Counter due={h.NextDue} done={done} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs">{h.LandLocation}</span>
                        {projectId === "all" && h.ProjectName && <span className="block text-[0.6875rem] font-semibold text-muted-foreground">{h.ProjectName}</span>}
                        <span className="block text-[0.6875rem] text-muted-foreground">RS {h.RsDagNo ?? "—"} · LR {h.LrDagNo ?? "—"}{h.LandCode ? ` · ${h.LandCode}` : ""}</span>
                        <span className="mt-1.5 block h-1.5 bg-muted"><span className={`block h-full ${done ? "bg-emerald-600" : h.DaysOver > 0 ? "bg-destructive" : "bg-amber-500"}`} style={{ width: `${pct}%` }} /></span>
                        <span className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground">
                          <span>Sources complete <b className="tabular-nums text-foreground">{h.OfficesDone} of {h.OfficesTotal}</b></span>
                          <span>Records found <b className="tabular-nums text-foreground">{h.Found}</b></span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!list.length && <li className="p-4 text-center text-xs text-muted-foreground">{isFetching ? "Loading…" : tab === "pending" ? "Nothing pending in this project" : tab === "overdue" ? "Nothing overdue in this project" : "No enquiry matches"}</li>}
              </ul>
              <div className="px-3 pb-3"><Pager page={page} pageSize={pageData?.pageSize ?? 20} total={pageData?.total ?? 0} loading={isFetching} onPage={setPage} /></div>
            </aside>

            {/* ── Work area ── */}
            <section className="legal-cq min-w-0">
              {current ? <EnquiryWork key={current.EnquiryId} enquiry={current} canEdit={rights.canEdit && !current.LandId} onOpenEnquiries={() => navigate("/legal/land/enquiries")} />
                : <div className="flex h-48 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">{list.length ? "Pick an enquiry from the list" : "No enquiry here — change the filter or the project"}</div>}
            </section>
          </div></div>
        )}
      </LegalShell>
    </>
  );
}

/** The order the land is traced in: RS record, LR record, CS record, then the registry offices (deeds), then
 *  searches added by hand to this enquiry. */
const SECTION_HINT: Record<string, string> = {
  sources: "Open each source tab (RS → LR → CS → registry deeds → others), choose the office, then mark every year: found, not found, not applicable… When all years are marked, complete the source.",
  parcels: "The plots this enquiry covers, and their areas compared (record, CS / RS / LR, offered, deed, surveyed).",
  mapping: "Link the CS, RS and LR records that are the same land; differences in holder or area show as alerts.",
  discrepancy: "Differences to investigate (holder, Dag, Khatian, area…) with severity, owner and resolution.",
  alternative: "Patta, lease, settlement, tenancy and other claims that are not in CS / RS / LR or deeds.",
  possession: "Who actually occupies the land — separate from the recorded owner.",
  review: "The legal officer's review and risk level. Open discrepancies or exceptions need a review that recommends proceeding.",
  summary: "Everything on one page with the overall status — print it or export it.",
};
type Section = "parcels" | "mapping" | "discrepancy" | "alternative" | "possession" | "review" | "summary";
const SECTIONS: [Section, string][] = [["parcels", "Parcels & area"], ["mapping", "Record mapping"], ["discrepancy", "Discrepancies"], ["alternative", "Alternative history"],
  ["possession", "Possession"], ["review", "Legal review"], ["summary", "Summary"]];
/** Investigation sections kept as lists on the enquiry (add / edit / history through the Legal list engine). */
const SECTION_LISTS: Partial<Record<Section, [string, string, string]>> = {
  discrepancy: ["enquiry-discrepancy", "Discrepancy", "Differences between records to investigate — holder, Dag, Khatian, area, missing or conflicting records. A difference is an alert, not proof of a defective title. Raise them from Record mapping or add them here."],
  alternative: ["enquiry-alt-history", "Alternative History Entry", "Land history outside CS / RS / LR and deeds: government patta, lease, settlement, khas / vested land, tenancy, bargadar, encroachment or other claims. These record information and claims — never proof of ownership. Pick a subcategory or type a new one with Other…."],
  possession: ["enquiry-possession", "Possession Entry", "Who actually occupies the land, from when, and on what basis — separate from recorded ownership. An occupant is never treated as the legal owner."],
  review: ["enquiry-search-review", "Legal Review", "The legal officer's review before Land Conversion. Every review is kept; the latest counts. Open discrepancies or search exceptions need a review recommending to proceed; Hold or Not Recommended stops conversion."],
};

function chainOrder(list: OfficeSearch[]): [string, OfficeSearch][] {
  const survey = (x: OfficeSearch) => x.SourceKind === "Survey record" || /^(CS|RS|LR) Record$/i.test(x.OfficeType);
  const rank = (x: OfficeSearch) => (survey(x) ? (/\bRS\b/i.test(x.OfficeType) ? 0 : /\bLR\b/i.test(x.OfficeType) ? 1 : 2)
    : x.SourceKind === "Land record office" ? 4 : x.SourceKind === "Registry office" && !x.ManualAdd ? 3 : 5);
  const label = (x: OfficeSearch, r: number) => (r < 3 ? x.OfficeType : ["", "", "", "Registry deeds", "Land record offices", "Other searches"][r]);
  return list.map((x, i) => ({ x, i, r: rank(x) })).sort((a, b) => a.r - b.r || a.i - b.i).map(({ x, r }) => [label(x, r), x]);
}
/** The CS / RS / LR record master for a survey source tab. */
const recordKey = (x: OfficeSearch) => (/\bCS\b/i.test(x.OfficeType) ? "enquiry-cs-record" : /\bRS\b/i.test(x.OfficeType) ? "enquiry-rs-record" : /\bLR\b/i.test(x.OfficeType) ? "enquiry-lr-record" : null);

function EnquiryWork({ enquiry, canEdit, onOpenEnquiries }: { enquiry: EnquiryHit; canEdit: boolean; onOpenEnquiries: () => void }) {
  const qc = useQueryClient();
  const { data: opts } = useQuery({ queryKey: ["legal-enq-search-options"], queryFn: getSearchOptions, staleTime: 10 * 60_000 });
  const { data, error } = useQuery({ queryKey: ["legal-enq-searches", enquiry.EnquiryId], queryFn: () => getEnquirySearches(enquiry.EnquiryId) });
  const [active, setActive] = useState<number | null>(null);
  // null = the search sources; otherwise one of the investigation sections.
  const [extra, setExtra] = useState<Section | null>(null);
  const mapping = extra !== null;
  const offices = data?.offices ?? [];
  // Open the office named in the link (dashboard overdue list), else the first one still pending (overdue first).
  useEffect(() => {
    if (active || !offices.length) return;
    const asked = new URLSearchParams(window.location.search).get("office");
    const named = asked && offices.find((o) => o.OfficeType === asked);
    if (named) { setActive(named.OfficeSearchId); return; }
    const next = [...offices].filter((o) => o.Status === "Pending").sort((a, b) => b.DaysOver - a.DaysOver || a.DueDate.localeCompare(b.DueDate))[0];
    setActive((next ?? offices[0]).OfficeSearchId);
  }, [offices, active]);
  const o = offices.find((x) => x.OfficeSearchId === active);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["legal-enq-searches", enquiry.EnquiryId] });
    qc.invalidateQueries({ queryKey: ["legal-enq-find"] });
    qc.invalidateQueries({ queryKey: ["legal-land-stats"] });
    qc.invalidateQueries({ queryKey: ["legal-enq-search-overdue"] });
    qc.invalidateQueries({ queryKey: ["legal-master", "land-enquiry"] });
  };
  const allDone = offices.length > 0 && offices.every((x) => x.Status === "Completed");

  return (
    <div className="border border-border bg-card">
      {/* Enquiry facts */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-base font-bold">{enquiry.EnquiryNo}{enquiry.LandCode && <span className="ml-2 text-sm font-normal text-muted-foreground">→ {enquiry.LandCode}</span>}</p>
          <p className="text-sm">{enquiry.LandLocation}</p>
          <p className="text-xs text-muted-foreground">{[enquiry.MouzaName, enquiry.DistrictName].filter(Boolean).join(", ")}{enquiry.JLNo ? ` · J.L. ${enquiry.JLNo}` : ""} · saved {enquiry.EnquiryDate}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">RS Dag / Khatian</dt><dd className="font-semibold">{enquiry.RsDagNo ?? "—"} / {enquiry.RsKhatianNo ?? "—"}</dd>
          <dt className="text-muted-foreground">LR Dag / Khatian</dt><dd className="font-semibold">{enquiry.LrDagNo ?? "—"} / {enquiry.LrKhatianNo ?? "—"}</dd>
        </dl>
      </div>
      {allDone && !enquiry.LandId && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-600/40 bg-emerald-600/5 px-4 py-2 text-sm">
          <span><b>Every office is searched.</b> The enquiry can now go to Land Conversion.</span>
          <button className={`${small} border-foreground font-semibold`} onClick={onOpenEnquiries}>Open Land Enquiries</button>
        </div>
      )}
      {error && <p className="px-4 py-2 text-sm text-destructive">{(error as Error).message}</p>}
      {data && !offices.length && <p className="px-4 py-3 text-sm text-amber-700">No registration office type is set up for {enquiry.StateName ?? "this enquiry's state"}. Add its types in Setup → Registration Office Types (state, time limit, "Timeline on every new enquiry"); this enquiry gets its timelines the next time it is opened.</p>}

      {/* Source tabs in tracing order: RS → LR → CS → Registry deeds (one sub-tab per office) → Other. */}
      {(() => {
        const chain = chainOrder(offices);
        const groups = [...new Set(chain.map(([g]) => g))];
        const cur = chain.find(([, x]) => x.OfficeSearchId === active);
        const curGroup = cur?.[0] ?? groups[0];
        const inGroup = chain.filter(([g]) => g === curGroup).map(([, x]) => x);
        const tone = (x: OfficeSearch) => (x.Status === "Completed" ? "bg-emerald-600" : x.DaysOver > 0 ? "bg-destructive" : "bg-amber-500");
        const worst = (list: OfficeSearch[]) => (list.every((x) => x.Status === "Completed") ? "bg-emerald-600" : list.some((x) => x.Status !== "Completed" && x.DaysOver > 0) ? "bg-destructive" : "bg-amber-500");
        return (
          <>
            {/* Two levels: the search (sources) and the investigation built on it */}
            <div className="flex overflow-x-auto border-b border-border bg-card px-2 pt-2" role="tablist" aria-label="Land Records Search sections">
              {([[null, "Search sources"], ...SECTIONS] as [Section | null, string][]).map(([k, l], i) => (
                <button key={l} role="tab" aria-selected={extra === k} onClick={() => setExtra(k)}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 border border-b-0 px-3 py-1.5 text-xs font-semibold ${extra === k ? "border-border bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center text-[0.625rem] ${extra === k ? "bg-foreground text-background" : "bg-muted"}`}>{i + 1}</span>{l}
                </button>
              ))}
            </div>
            <p className="border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">{SECTION_HINT[extra ?? "sources"]}</p>
            {!mapping && <div className="flex overflow-x-auto border-b border-border bg-muted/30" role="tablist">
              {groups.map((g, i) => {
                const list = chain.filter(([x]) => x === g).map(([, x]) => x);
                const doneN = list.filter((x) => x.Status === "Completed").length;
                const on = g === curGroup;
                return (
                  <button key={g} role="tab" aria-selected={on && !mapping}
                    onClick={() => { const first = list.find((x) => x.Status === "Pending") ?? list[0]; setActive(first.OfficeSearchId); }}
                    className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-left ${on && !mapping ? "border-foreground bg-card" : "border-transparent hover:bg-card/60"}`}>
                    <span className="flex items-center gap-2">
                      <span className="text-[0.625rem] tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className={`h-2 w-2 rounded-full ${worst(list)}`} />
                      <span className={`text-sm ${on ? "font-bold" : "font-semibold"}`}>{g}</span>
                    </span>
                    <span className="mt-0.5 block pl-5 text-[0.6875rem] text-muted-foreground">
                      {list.length > 1 ? `${doneN}/${list.length} complete` : list[0].Status === "Completed" ? "Complete" : daysCounter(list[0].DueDate)?.text}
                      {list.every((x) => x.Mandatory === false) ? " · optional" : ""}
                    </span>
                  </button>
                );
              })}
            </div>}
            {!mapping && inGroup.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
                {inGroup.map((x) => {
                  const n = data?.years.filter((y) => y.OfficeType === x.OfficeType).length ?? 0;
                  const on = x.OfficeSearchId === active;
                  return (
                    <button key={x.OfficeSearchId} onClick={() => setActive(x.OfficeSearchId)}
                      className={`flex items-center gap-1.5 border px-2.5 py-1 text-xs ${on ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/50"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone(x)}`} />
                      <b>{x.OfficeType}</b>
                      <span className={on ? "opacity-80" : "text-muted-foreground"}>· {x.Status === "Completed" ? "done" : x.DaysOver > 0 ? `${x.DaysOver}d late` : `${n} yr`}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!mapping && o && data && (() => {
              const found = data.years.filter((y) => y.OfficeType === o.OfficeType && y.Status === "Found").sort((a, b) => a.CalendarYear - b.CalendarYear);
              return found.length > 0 ? (
                <div className="border-b border-border bg-emerald-600/5 px-4 py-2">
                  <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-emerald-800">Found in {o.OfficeType}</p>
                  {found.map((f) => (
                    <p key={f.SearchId} className="flex gap-2 text-xs"><b className="w-10 shrink-0 tabular-nums">{f.CalendarYear}</b>
                      <span><b>{f.DeedNo ?? "Found"}</b>{f.Parties ? ` · ${f.Parties}` : ""}{f.Details ? <span className="text-muted-foreground"> — {f.Details}</span> : null}</span></p>
                  ))}
                </div>
              ) : null;
            })()}
          </>
        );
      })()}
      {extra === "parcels" && legalMasterByKey("land-enquiry") && <div className="p-4"><ParcelsView q={{ enquiryId: enquiry.EnquiryId }} parentId={enquiry.EnquiryId} editable={canEdit && !enquiry.LandId}
        entry={{ ...legalMasterByKey("land-enquiry")!, key: "enquiry-parcel", label: "Land Parcel" }} /></div>}
      {extra === "mapping" && <RecordMapping enquiryId={enquiry.EnquiryId} canEdit={canEdit && !enquiry.LandId} />}
      {extra && SECTION_LISTS[extra] && (() => {
        const enq = legalMasterByKey("land-enquiry");
        const [key, title, note] = SECTION_LISTS[extra]!;
        return enq ? (
          <div className="space-y-2 p-4">
            <p className="border-l-2 border-sky-600 bg-sky-500/5 px-3 py-2 text-xs">{note}</p>
            <LegalMasterTable key={`${key}-${enquiry.EnquiryId}`} entry={{ ...enq, key, label: title }} parentId={enquiry.EnquiryId} noAdd={!canEdit || !!enquiry.LandId}
              onSaved={() => qc.invalidateQueries({ queryKey: ["legal-enq-summary", enquiry.EnquiryId] })} />
          </div>
        ) : null;
      })()}
      {extra === "summary" && <LandRecordsSummaryView enquiryId={enquiry.EnquiryId} />}
      {!mapping && canEdit && !enquiry.LandId && data && <AddSearch enquiryId={enquiry.EnquiryId} opts={opts} have={offices.map((x) => x.OfficeType)}
        onAdded={() => { qc.invalidateQueries({ queryKey: ["legal-enq-search-options"] }); refresh(); }} />}
      {!mapping && o && data && <OfficePanel key={o.OfficeSearchId} o={o} years={data.years.filter((y) => y.OfficeType === o.OfficeType)} opts={opts} enquiry={enquiry} canEdit={canEdit} onChanged={refresh} />}
    </div>
  );
}

/** "+ Add search": another search for this enquiry — pick one from the setup list or type a new one (Other…). */
function AddSearch({ enquiryId, opts, have, onAdded }: { enquiryId: number; opts?: SearchOptions; have: string[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [fromYear, setFromYear] = useState("1956");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  // The setup list's own "Other" row is left out: Other… (type a new one) covers it.
  const choices = (opts?.officeTypes ?? []).filter((t) => !have.includes(t.OfficeType) && !/^other$/i.test(t.OfficeType.trim()));
  const other = pick === "__other";
  const save = async () => {
    if (!pick || (other && !name.trim())) { toast.error(other ? "Type the name of the search" : "Pick a search"); return; }
    setBusy(true);
    try {
      const r = await addEnquirySearch(enquiryId, other ? { name: name.trim(), fromYear: Number(fromYear), slaDays: Number(days) } : { officeTypeId: Number(pick) });
      toast.success(r.message); setOpen(false); setPick(""); setName(""); onAdded();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  if (!open) return (
    <div className="flex justify-end border-b border-border px-3 py-1.5">
      <button className={small} onClick={() => setOpen(true)} title="Search another office or record (e.g. an old CS record, a municipality register)">+ Add search</button>
    </div>
  );
  return (
    <div className="grid gap-2 border-b border-border bg-muted/30 px-3 py-2 sm:grid-cols-[1.4fr_1.4fr_0.7fr_0.7fr_auto] sm:items-end">
      <label className="text-xs text-muted-foreground">Search
        <select className={`${field} mt-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Select…</option>
          {choices.map((t) => <option key={t.OfficeTypeId} value={t.OfficeTypeId}>{t.OfficeType} · from {t.FromYear}</option>)}
          <option value="__other">Other… (type a new one)</option>
        </select>
      </label>
      {other ? (
        <>
          <label className="text-xs text-muted-foreground">Name (saved to the setup list)
            <input className={`${field} mt-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Municipality register" autoFocus /></label>
          <label className="text-xs text-muted-foreground">From year
            <input className={`${field} mt-1`} type="number" min={1800} max={new Date().getFullYear()} value={fromYear} onChange={(e) => setFromYear(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Days allowed
            <input className={`${field} mt-1`} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        </>
      ) : <span className="text-xs text-muted-foreground sm:col-span-3">{pick ? "Searched year by year from its start year, like the offices above." : "Pick from the setup list, or Other… to add a new one."}</span>}
      <span className="flex gap-1">
        <button className={small} onClick={() => setOpen(false)}>Cancel</button>
        <button disabled={busy} className="bg-foreground px-3 py-1 text-xs font-semibold text-card disabled:opacity-40" onClick={save}>{busy ? "Adding…" : "Add"}</button>
      </span>
    </div>
  );
}

function OfficePanel({ o, years, opts, enquiry, canEdit, onChanged }: {
  o: OfficeSearch; years: YearResult[]; opts?: SearchOptions; enquiry: EnquiryHit; canEdit: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const done = o.Status === "Completed";
  const editable = canEdit && !done;
  const [officeName, setOfficeName] = useState(o.OfficeName ?? "");
  const [year, setYear] = useState<number | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; site: string; status: string; reason?: string } | null>(null);
  const byYear = useMemo(() => new Map(years.map((y) => [y.CalendarYear, y])), [years]);
  const first = o.FromYear || 1956;
  const last = o.ToYear || thisYear;
  const allYears = useMemo(() => Array.from({ length: last - first + 1 }, (_, i) => last - i), [first, last]);
  const found = years.filter((y) => y.Status === "Found");
  // Offices of this type in the enquiry's state only (an office in another state never searches this land).
  const offices = useMemo(() => (opts?.offices ?? []).filter((x) => x.OfficeType === o.OfficeType && (!enquiry.StateName || !x.StateName || x.StateName === enquiry.StateName))
    .sort((a, b) => Number(b.DistrictName === enquiry.DistrictName) - Number(a.DistrictName === enquiry.DistrictName)), [opts, o.OfficeType, enquiry.DistrictName, enquiry.StateName]);
  const matched = offices.find((x) => x.OfficeName.toLowerCase() === officeName.trim().toLowerCase());

  const saveOffice = async () => {
    const name = officeName.trim();
    if (!name || name === o.OfficeName) return;
    try {
      let id = matched?.OfficeId ?? null;
      if (!id) {
        if (!o.OfficeTypeId) throw new Error("This office type is not in Setup → Registration Office Types");
        const added = await addOffice({ officeName: name, officeTypeId: o.OfficeTypeId, enquiryId: enquiry.EnquiryId });
        id = added.OfficeId;
        toast.success(added.message);
        qc.invalidateQueries({ queryKey: ["legal-enq-search-options"] });
        qc.invalidateQueries({ queryKey: ["legal-lookup", "registration-office"] });
      }
      await setOfficeOf(o.OfficeSearchId, id);
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not set the office"); }
  };
  const inRange = years.filter((y) => y.CalendarYear >= first && y.CalendarYear <= last);
  const finalN = inRange.filter((y) => ["Found", "Not Found", "Not Applicable"].includes(y.Status)).length;
  const reviewN = inRange.filter((y) => WAITING.includes(y.Status)).length;
  const noAccessN = inRange.filter((y) => NO_ACCESS.includes(y.Status)).length;
  const pendingN = allYears.length - finalN - reviewN - noAccessN;
  const recKey = recordKey(o);
  // Same way Land Enquiries opens these child lists: the enquiry master entry with the record key.
  const enqEntry = legalMasterByKey("land-enquiry");
  const recEntry = recKey && enqEntry ? { ...enqEntry, key: recKey, label: `${recKey.slice(8, 10).toUpperCase()} Record` } : undefined;
  const complete = async () => {
    if (pendingN || reviewN) { toast.error(`${pendingN ? `${pendingN} year${pendingN > 1 ? "s" : ""} not searched` : ""}${pendingN && reviewN ? " and " : ""}${reviewN ? `${reviewN} still waiting` : ""} — every year needs a final result first`); return; }
    const remarks = await askLegal({
      title: `Complete the ${o.OfficeType} search?`,
      message: `${years.length} of ${allYears.length} years recorded (${found.length} found). This stops the ${o.OfficeType} timeline.`,
      input: { label: "Remarks", required: !years.length }, confirmText: noAccessN ? "Next" : "Complete",
    });
    if (remarks === null) return;
    let exception: string | undefined;
    if (noAccessN) {
      const x = await askLegal({ title: "Complete with an exception?", tone: "danger",
        message: `${noAccessN} year${noAccessN > 1 ? "s" : ""} could not be accessed or are not digitised — that is not "not found". Completing records an exception (needs Land Enquiry approve right).`,
        input: { label: "Exception reason", required: true }, confirmText: "Complete with exception" });
      if (!x) return;
      exception = x;
    }
    try { toast.success((await completeOffice(o.OfficeSearchId, remarks, exception)).message); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not complete"); }
  };
  const reopen = async () => {
    const reason = await askLegal({ title: `Reopen the ${o.OfficeType} search?`, message: "Use this when it was marked complete by mistake or a year must be corrected.", input: { label: "Reason", required: true }, confirmText: "Reopen" });
    if (!reason) return;
    try { toast.success((await reopenOffice(o.OfficeSearchId, reason)).message); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not reopen"); }
  };
  const earlier = async () => {
    const y = await askLegal({ title: `Search ${o.OfficeType} before ${first}?`, message: "Records before the usual start year are needed. Those years then have to be searched too before the office can be completed.", input: { label: "Start from year (e.g. 1930)", required: true }, confirmText: "Next" });
    if (!y) return;
    const reason = await askLegal({ title: `Why are records from ${y} needed?`, input: { label: "Reason", required: true }, confirmText: "Save" });
    if (!reason) return;
    try { toast.success((await setOfficeFromYear(o.OfficeSearchId, Number(y), reason)).message); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const saveRange = async () => {
    if (!range) return;
    try {
      toast.success((await addYearRange(o.OfficeSearchId, { from: Number(range.from), to: Number(range.to), siteName: range.site, status: range.status as "Not Found", details: range.reason })).message);
      setRange(null); onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const picked = year != null ? byYear.get(year) ?? null : null;

  return (
    <div className="space-y-4 p-4">
      {/* Timeline + office */}
      <div className="legal-g2">
        <div className={`border p-3 ${done ? "border-emerald-600/40 bg-emerald-600/5" : o.DaysOver > 0 ? "border-destructive bg-destructive/10" : "border-amber-500/50 bg-amber-500/5"}`}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Timeline</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><b>Due</b> <DueBadge date={o.DueDate} done={done} compact /><Counter due={o.DueDate} done={done} /></p>
          <p className="text-xs text-muted-foreground">{o.SlaDays}-day limit · years {first}–{last} · {o.Mandatory === false ? "optional" : "mandatory before Land Conversion"}</p>
          {o.ExceptionNote && <p className="mt-1 text-xs text-destructive">Completed with exception: {o.ExceptionNote}</p>}
          {done && <p className="mt-1 text-xs">Completed{o.CompletedByName ? ` by ${o.CompletedByName}` : ""}{o.CompletedAt ? ` · ${o.CompletedAt.slice(0, 10)}` : ""}{o.Remarks ? ` — ${o.Remarks}` : ""}</p>}
        </div>
        <div className="border border-border p-3">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{o.OfficeType} office</p>
          {editable ? (
            <>
              <input className={`${field} mt-1`} list={`off-${o.OfficeSearchId}`} value={officeName} placeholder={`Pick from the master or type a new ${o.OfficeType} office`}
                onChange={(e) => setOfficeName(e.target.value)} onBlur={saveOffice} onKeyDown={(e) => e.key === "Enter" && saveOffice()} />
              <datalist id={`off-${o.OfficeSearchId}`}>{offices.map((x) => <option key={x.OfficeId} value={x.OfficeName}>{x.DistrictName ?? ""}</option>)}</datalist>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                {officeName.trim() && !matched && officeName.trim() !== o.OfficeName ? <span className="text-amber-700">New office — added to Setup → Deed Registration Office when you leave the box</span>
                  : `${offices.length} ${o.OfficeType} office${offices.length === 1 ? "" : "s"} in ${enquiry.StateName ?? "the master"}${enquiry.DistrictName ? `; ${enquiry.DistrictName} first` : ""}`}
              </p>
            </>
          ) : <p className="mt-1 text-sm font-semibold">{o.OfficeName ?? "—"}</p>}
        </div>
      </div>

      <GovtSiteLinks hint={`Search ${o.OfficeType} records on the official site (opens in a new tab), then record each year below.`} />

      {/* The actual record entries (survey sources): Khatian, Dag, holder, area, class, source, status, copy. */}
      {recEntry && (
        <div className="border border-border">
          <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {o.OfficeType} entries · the records themselves (a year above only logs the search)
          </p>
          <div className="p-2">
            <LegalMasterTable key={`${recKey}-${enquiry.EnquiryId}`} entry={recEntry} parentId={enquiry.EnquiryId} noAdd={!canEdit || !!enquiry.LandId}
              onSaved={() => { qc.invalidateQueries({ queryKey: ["legal-enq-records", enquiry.EnquiryId] }); qc.invalidateQueries({ queryKey: ["legal-master", "land-enquiry"] }); }} />
          </div>
        </div>
      )}

      {/* Year grid */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Search coverage {first}–{last} <span className="font-normal text-muted-foreground">· {finalN}/{allYears.length} final · {found.length} found{reviewN ? ` · ${reviewN} waiting` : ""}{noAccessN ? ` · ${noAccessN} no access` : ""}{pendingN ? ` · ${pendingN} not searched` : ""}</span></p>
          <div className="flex flex-wrap items-center gap-3 text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-emerald-600 bg-emerald-600/80" />Found</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-border bg-muted-foreground/30" />Not found</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-sky-500 bg-sky-500/20" />Not applicable</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-amber-500 bg-amber-400/60" />Waiting (review / copy / reply)</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-destructive bg-destructive/20" />No access / not digitised</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-border bg-background" />Pending (not searched)</span>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1">
          {allYears.map((y) => {
            const r = byYear.get(y);
            return (
              <button key={y} onClick={() => setYear(year === y ? null : y)} disabled={!editable && !r}
                title={r ? `${y}: ${r.Status}${r.DeedNo ? ` · deed ${r.DeedNo}` : ""}` : `${y}: pending — not searched`}
                className={`h-8 border text-xs tabular-nums ${year === y ? "ring-2 ring-foreground" : ""} ${r?.Status === "Found" ? "border-emerald-700 bg-emerald-600/80 font-semibold text-white" : r?.Status === "Not Applicable" ? "border-sky-500 bg-sky-500/20 text-sky-900 dark:text-sky-200" : r && WAITING.includes(r.Status) ? "border-amber-500 bg-amber-400/60 font-semibold" : r && NO_ACCESS.includes(r.Status) ? "border-destructive bg-destructive/20 font-semibold text-destructive" : r ? "border-border bg-muted-foreground/25 text-muted-foreground" : "border-border bg-background hover:bg-muted"} disabled:cursor-default`}>
                {y}
              </button>
            );
          })}
        </div>
        {editable && (
          <div className="mt-2 flex flex-wrap gap-2">
            {!range && <button className={small} onClick={() => setRange({ from: String(first), to: String(thisYear), site: "", status: "Not Found" })}>Mark a range of years…</button>}
            <button className={small} onClick={earlier} title="When records before the usual start year are needed">Search before {first}…</button>
          </div>
        )}
        {range && (
          <div className="mt-2 flex flex-wrap items-end gap-2 border border-border bg-muted/30 p-2 text-xs">
            <label>From<select className={`${field} w-24`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })}>{[...allYears].reverse().map((y) => <option key={y}>{y}</option>)}</select></label>
            <label>To<select className={`${field} w-24`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })}>{allYears.map((y) => <option key={y}>{y}</option>)}</select></label>
            <label className="min-w-[14rem] flex-1">Government site checked<input className={field} value={range.site} placeholder="e.g. WB Registration (igr.wb.gov.in)" onChange={(e) => setRange({ ...range, site: e.target.value })} /></label>
            <label>As<select className={`${field} w-48`} value={range.status} onChange={(e) => setRange({ ...range, status: e.target.value })}>
              {YEAR_STATUSES.filter((x) => x !== "Found").map((x) => <option key={x}>{x}</option>)}</select></label>
            {range.status === "Not Applicable" && <label className="min-w-[12rem] flex-1">Reason *<input className={field} value={range.reason ?? ""} onChange={(e) => setRange({ ...range, reason: e.target.value })} /></label>}
            <button className="h-9 bg-foreground px-3 font-semibold text-card" onClick={saveRange}>Save range as {range.status.toLowerCase()}</button>
            <button className="h-9 underline" onClick={() => setRange(null)}>Cancel</button>
            <p className="w-full text-muted-foreground">Years already recorded in the range are kept as they are.</p>
          </div>
        )}
      </div>

      {year != null && (editable || picked) && (
        <YearPanel key={`${year}-${picked?.SearchId ?? "new"}`} year={year} r={picked} editable={editable}
          onClose={() => setYear(null)}
          onSave={async (b) => {
            try {
              toast.success((picked ? await editYearResult(picked.SearchId, b) : await addYearResult(o.OfficeSearchId, { ...b, calendarYear: year })).message);
              setYear(null); onChanged();
            } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
          }}
          onDelete={picked ? async () => {
            if (!(await askLegal({ title: `Remove ${o.OfficeType} ${year}?`, message: "The recorded result is deleted.", confirmText: "Remove", tone: "danger" }))) return;
            try { toast.success((await deleteYearResult(picked.SearchId)).message); setYear(null); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
          } : undefined} />
      )}

      {/* Deeds found */}
      {found.length > 0 && (
        <div className="border border-border">
          <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Found · {o.OfficeType}</p>
          <table className="w-full text-left text-xs">
            <tbody>
              {found.map((y) => (
                <tr key={y.SearchId} className="cursor-pointer border-t border-border first:border-t-0 hover:bg-muted/40" onClick={() => setYear(y.CalendarYear)}>
                  <td className="px-3 py-1.5 font-semibold tabular-nums">{y.CalendarYear}</td>
                  <td className="px-3 py-1.5"><b>{y.DeedNo}</b>{y.DeedDate ? ` · ${y.DeedDate}` : ""}</td>
                  <td className="px-3 py-1.5">{y.Parties ?? ""}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{y.SiteName ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {!done && (pendingN || reviewN) ? <span className="mr-auto self-center text-xs text-amber-700">Complete needs every year final: {pendingN ? `${pendingN} not searched` : ""}{pendingN && reviewN ? " · " : ""}{reviewN ? `${reviewN} waiting` : ""}</span>
            : !done && noAccessN ? <span className="mr-auto self-center text-xs text-destructive">{noAccessN} year{noAccessN > 1 ? "s" : ""} without access — completing needs an exception</span> : null}
          {!done && <button className="bg-foreground px-4 py-2 text-sm font-semibold text-card disabled:opacity-40" disabled={!!(pendingN || reviewN)} onClick={complete}>Mark {o.OfficeType} search complete</button>}
          {done && <button className={small} onClick={reopen}>Reopen {o.OfficeType} search</button>}
        </div>
      )}
    </div>
  );
}

function YearPanel({ year, r, editable, onSave, onDelete, onClose }: {
  year: number; r: YearResult | null; editable: boolean; onSave: (b: YearBody) => Promise<void>; onDelete?: () => void; onClose: () => void;
}) {
  const [result, setResult] = useState<YearStatus>(r?.Status === "Requested" ? "Under Review" : (r?.Status as YearStatus) ?? "Found");
  const [deedNo, setDeedNo] = useState(r?.DeedNo ?? "");
  const [deedDate, setDeedDate] = useState(r?.DeedDate ?? "");
  const [parties, setParties] = useState(r?.Parties ?? "");
  const [details, setDetails] = useState(r?.Details ?? "");
  const [siteName, setSiteName] = useState(r?.SiteName ?? "");
  const [method, setMethod] = useState(r?.SearchMethod ?? "");
  const [refNo, setRefNo] = useState(r?.ReferenceNo ?? "");
  const [searchDate, setSearchDate] = useState(r?.SearchDate ?? new Date().toISOString().slice(0, 10));
  const [evidence, setEvidence] = useState<{ id: number; name: string } | null>(r?.EvidenceFileId ? { id: r.EvidenceFileId, name: r.EvidenceFileName ?? `File #${r.EvidenceFileId}` } : null);
  const [busy, setBusy] = useState(false);
  const needReason = result === "Not Applicable" && !details.trim();
  return (
    <div className="border-2 border-foreground/70 bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold">{year}{r ? <span className="ml-2 text-xs font-normal text-muted-foreground">recorded{r.RecordedByName ? ` by ${r.RecordedByName}` : ""}</span> : <span className="ml-2 text-xs font-normal text-muted-foreground">not searched yet</span>}</p>
        <button className="text-xs underline" onClick={onClose}>Close</button>
      </div>
      <fieldset disabled={!editable} className="legal-g2">
        <div className="grid grid-cols-2 gap-2 legal-span sm:flex sm:flex-wrap">
          {YEAR_STATUSES.map((x) => (
            <button key={x} type="button" onClick={() => setResult(x)}
              className={`border px-2.5 py-1.5 text-xs font-semibold ${result === x ? (x === "Found" ? "border-emerald-700 bg-emerald-600 text-white" : x === "Not Applicable" ? "border-sky-600 bg-sky-600 text-white" : WAITING.includes(x) ? "border-amber-500 bg-amber-500 text-white" : NO_ACCESS.includes(x) ? "border-destructive bg-destructive text-white" : "border-foreground bg-foreground text-card") : "border-border"}`}>{x}</button>
          ))}
        </div>
        {result === "Found" && (
          <>
            <label className="text-xs">Deed / record number *<input className={field} value={deedNo} maxLength={100} onChange={(e) => setDeedNo(e.target.value)} autoFocus /></label>
            <label className="text-xs">Deed date<input type="date" className={field} value={deedDate} onChange={(e) => setDeedDate(e.target.value)} /></label>
            <label className="text-xs legal-span">Parties (seller → buyer)<input className={field} value={parties} maxLength={500} onChange={(e) => setParties(e.target.value)} /></label>
          </>
        )}
        <label className="text-xs legal-span">{result === "Not Applicable" ? "Reason (required)" : "Details / remarks"}<input className={field} value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} /></label>
        <label className="text-xs">Search method<select className={field} value={method} onChange={(e) => setMethod(e.target.value)}><option value="">—</option>{SEARCH_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="text-xs">Search date<input type="date" className={field} value={searchDate} onChange={(e) => setSearchDate(e.target.value)} /></label>
        <label className="text-xs">Reference number<input className={field} value={refNo} maxLength={100} placeholder="Application / receipt / copy no." onChange={(e) => setRefNo(e.target.value)} /></label>
        <label className="text-xs">Evidence (copy, reply, screenshot)
          <span className="flex items-center gap-2">
            {evidence ? <><span className="truncate">{evidence.name}</span><button type="button" className="underline" onClick={() => setEvidence(null)}>remove</button></>
              : <input type="file" accept="application/pdf,image/*" className="text-xs" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { const up = await uploadLegalFile(f); setEvidence({ id: up.id, name: up.fileName }); } catch (err) { toast.error((err as Error).message); }
              }} />}
          </span>
          {method === "Online portal" && <span className="text-[0.625rem] text-muted-foreground">A screenshot or online result is not a certified copy.</span>}
        </label>
        <label className="text-xs legal-span">Government site checked<input className={field} value={siteName} maxLength={200} placeholder="e.g. WB Registration (igr.wb.gov.in)" onChange={(e) => setSiteName(e.target.value)} /></label>
      </fieldset>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy || (result === "Found" && !deedNo.trim()) || needReason} className="bg-foreground px-4 py-1.5 text-sm font-semibold text-card disabled:opacity-40"
            onClick={async () => { setBusy(true); await onSave({ result, deedNo, deedDate, parties, details, siteName, searchMethod: method || undefined, referenceNo: refNo || undefined, searchDate, evidenceFileId: evidence?.id }); setBusy(false); }}>
            Save {year}
          </button>
          {onDelete && <button className={`${small} text-rose-600`} onClick={onDelete}>Delete</button>}
        </div>
      )}
    </div>
  );
}
