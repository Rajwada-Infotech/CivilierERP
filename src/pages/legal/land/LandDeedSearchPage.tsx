import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SearchStatus } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { ProjectPicker, useLegalProject } from "@/components/legal/ProjectPicker";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getSearchOptions, findEnquiries, getEnquirySearches, setOfficeOf, addYearResult, editYearResult, deleteYearResult, addYearRange,
  completeOffice, reopenOffice, addOffice, daysCounter,
  type EnquiryHit, type OfficeSearch, type YearResult, type YearBody, type SearchOptions,
} from "@/api/legalEnquirySearchApi";

const field = "h-9 w-full border border-border bg-background px-2 text-sm";
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
  const [remembered, setRemembered] = useLegalProject();
  // "All projects" comes only from the link (?project=all, the dashboard report) or the picker; it is not remembered.
  const [all_, setAll] = useState(new URLSearchParams(window.location.search).get("project") === "all");
  const projectId: number | "all" | null = all_ ? "all" : remembered;
  const setProjectId = (id: number | null | "all") => { if (id === "all") setAll(true); else { setAll(false); setRemembered(id); } };
  const start = new URLSearchParams(window.location.search).get("q") ?? "";
  const [q, setQ] = useState(start);
  const [pickedId, setPickedId] = useState<number | null>(null);
  // ?view= from the dashboard report opens that portion: pending, overdue, ontime, done or all.
  const VIEWS = ["pending", "overdue", "ontime", "done", "all"] as const;
  type View = (typeof VIEWS)[number];
  const asked = new URLSearchParams(window.location.search).get("view") as View | null;
  const [tab, setTab] = useState<View>(asked && VIEWS.includes(asked) ? asked : start ? "all" : "pending");

  const { data: all = [], isFetching, error } = useQuery({
    queryKey: ["legal-enq-find", projectId, "", "all"],
    queryFn: () => findEnquiries(projectId!, "", "all"),
    enabled: !!projectId,
  });
  const isDone = (h: EnquiryHit) => !!h.LandId || h.EnquiryStatus === "Rejected" || h.OfficesDone >= h.OfficesTotal;
  const pendingN = all.filter((h) => !isDone(h)).length;
  const overdueN = all.filter((h) => !isDone(h) && h.DaysOver > 0).length;
  // Filter on the client: instant while typing (enquiry no, Land ID, location, RS / LR Dag or Khatian).
  const term = q.trim().toLowerCase();
  const list = all
    .filter((h) => (tab === "pending" ? !isDone(h) : tab === "overdue" ? !isDone(h) && h.DaysOver > 0
      : tab === "ontime" ? !isDone(h) && !h.DaysOver : tab === "done" ? isDone(h) : true))
    .filter((h) => !term || [h.EnquiryNo, h.LandCode, h.LandLocation, h.RsDagNo, h.LrDagNo, h.RsKhatianNo, h.LrKhatianNo, h.MouzaName]
      .some((v) => String(v ?? "").toLowerCase().includes(term)));
  const current = all.find((h) => h.EnquiryId === pickedId) ?? null;
  const doneN = all.filter(isDone).length;

  // Link values (?project, ?q, ?view, ?office from the dashboard / Land Enquiries) are used once; any choice made here
  // drops them from the address so a refresh or the next pick does not bring them back.
  const dropLink = () => { if (window.location.search) navigate("/legal/land/deed-search", { replace: true }); };
  // Switching the project by hand starts clean: no search text, no open enquiry, the Pending list.
  const changeProject = (id: number | null | "all") => { setProjectId(id); setPickedId(null); setQ(""); setTab("pending"); dropLink(); };
  const pick = (id: number) => { setPickedId(id); dropLink(); };

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
      setProjectId(projects.length === 1 && projects[0] ? projects[0] : "all");
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
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", "Deed Registry Search"]} />
      <LegalShell title="Deed Registry Search" subtitle="Each enquiry gets a timeline per registration office when it is saved. Pick an enquiry, then search each office year by year; what you find is stored on the enquiry." icon={SearchStatus}>
        <ProjectPicker value={projectId} allowAll onChange={changeProject}>
          <form className="flex min-w-[18rem] flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); findEverywhere(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enquiry no, Land ID, RS / LR Dag or Khatian, mouza — filters this list; Search looks in all projects"
              className="h-9 flex-1 border border-border bg-background px-3 text-sm" />
            <button disabled={finding || !q.trim()} className="h-9 border border-foreground bg-foreground px-4 text-sm font-semibold text-card disabled:opacity-40">{finding ? "Searching…" : "Search"}</button>
            {q && <button type="button" className="text-xs underline" onClick={() => { setQ(""); setPickedId(null); dropLink(); }}>Clear</button>}
          </form>
        </ProjectPicker>
        {projectId && (
          <div className="legal-cq"><div className="legal-split">
            {/* ── Queue ── */}
            <aside className="legal-queue border border-border bg-card">
              <div className="space-y-2 border-b border-border p-3">
                {term && <p className="text-xs text-muted-foreground">Filtered by “{q.trim()}” · {list.length} shown</p>}
                <div className="grid grid-cols-3 border border-border text-[0.6875rem] font-semibold uppercase tracking-wider">
                  {([["pending", `Pending ${pendingN}`], ["done", `Completed ${doneN}`], ["all", `All ${all.length}`]] as const).map(([k, l]) => (
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
                        <span className="mt-1.5 flex items-center gap-2">
                          <span className="h-1.5 flex-1 bg-muted"><span className={`block h-full ${done ? "bg-emerald-600" : h.DaysOver > 0 ? "bg-destructive" : "bg-amber-500"}`} style={{ width: `${pct}%` }} /></span>
                          <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{h.OfficesDone}/{h.OfficesTotal} · {h.Found} found</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!list.length && <li className="p-4 text-center text-xs text-muted-foreground">{isFetching ? "Loading…" : tab === "pending" ? "Nothing pending in this project" : tab === "overdue" ? "Nothing overdue in this project" : "No enquiry matches"}</li>}
              </ul>
            </aside>

            {/* ── Work area ── */}
            <section className="legal-cq min-w-0">
              {current ? <EnquiryWork key={current.EnquiryId} enquiry={current} canEdit={rights.canEdit && !current.LandId} onOpenEnquiries={() => navigate("/legal/land/enquiries")} />
                : <div className="flex h-48 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">Pick an enquiry from the list to search its registration offices</div>}
            </section>
          </div></div>
        )}
      </LegalShell>
    </>
  );
}

function EnquiryWork({ enquiry, canEdit, onOpenEnquiries }: { enquiry: EnquiryHit; canEdit: boolean; onOpenEnquiries: () => void }) {
  const qc = useQueryClient();
  const { data: opts } = useQuery({ queryKey: ["legal-enq-search-options"], queryFn: getSearchOptions, staleTime: 10 * 60_000 });
  const { data, error } = useQuery({ queryKey: ["legal-enq-searches", enquiry.EnquiryId], queryFn: () => getEnquirySearches(enquiry.EnquiryId) });
  const [active, setActive] = useState<number | null>(null);
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

      {/* Office tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2">
        {offices.map((x) => {
          const done = x.Status === "Completed";
          const n = data?.years.filter((y) => y.OfficeType === x.OfficeType).length ?? 0;
          return (
            <button key={x.OfficeSearchId} onClick={() => setActive(x.OfficeSearchId)}
              className={`-mb-px shrink-0 border border-b-0 px-3 py-2 text-left ${active === x.OfficeSearchId ? "border-border bg-background" : "border-transparent hover:bg-muted/50"}`}>
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${done ? "bg-emerald-600" : x.DaysOver > 0 ? "bg-destructive" : "bg-amber-500"}`} />
                <span className="text-sm font-semibold">{x.OfficeType}</span>
              </span>
              <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{done ? "Completed" : daysCounter(x.DueDate)?.text} · {n} yr</span>
            </button>
          );
        })}
      </div>
      {o && data && <OfficePanel key={o.OfficeSearchId} o={o} years={data.years.filter((y) => y.OfficeType === o.OfficeType)} opts={opts} enquiry={enquiry} canEdit={canEdit} onChanged={refresh} />}
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
  const [range, setRange] = useState<{ from: string; to: string; site: string } | null>(null);
  const byYear = useMemo(() => new Map(years.map((y) => [y.CalendarYear, y])), [years]);
  const first = o.FromYear || 1956;
  const allYears = useMemo(() => Array.from({ length: thisYear - first + 1 }, (_, i) => thisYear - i), [first]);
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
  const complete = async () => {
    const left = allYears.length - years.length;
    const remarks = await askLegal({
      title: `Complete the ${o.OfficeType} search?`,
      message: `${years.length} of ${allYears.length} years recorded (${found.length} deed${found.length === 1 ? "" : "s"} found)${left ? `; ${left} not recorded` : ""}. This stops the ${o.OfficeType} timeline.`,
      input: { label: "Remarks", required: !years.length }, confirmText: "Complete",
    });
    if (remarks === null) return;
    try { toast.success((await completeOffice(o.OfficeSearchId, remarks)).message); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not complete"); }
  };
  const reopen = async () => {
    try { toast.success((await reopenOffice(o.OfficeSearchId)).message); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not reopen"); }
  };
  const saveRange = async () => {
    if (!range) return;
    try {
      toast.success((await addYearRange(o.OfficeSearchId, { from: Number(range.from), to: Number(range.to), siteName: range.site })).message);
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
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><b>Due {o.DueDate}</b><Counter due={o.DueDate} done={done} /></p>
          <p className="text-xs text-muted-foreground">{o.SlaDays}-day limit from the enquiry date · years {first}–{thisYear}</p>
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

      {/* Year grid */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Calendar years <span className="font-normal text-muted-foreground">· {years.length}/{allYears.length} recorded · {found.length} found</span></p>
          <div className="flex flex-wrap items-center gap-3 text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-emerald-600 bg-emerald-600/80" />Found</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-border bg-muted-foreground/30" />Not found</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 border border-border bg-background" />Not searched</span>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1">
          {allYears.map((y) => {
            const r = byYear.get(y);
            return (
              <button key={y} onClick={() => setYear(year === y ? null : y)} disabled={!editable && !r}
                title={r ? `${y}: ${r.Status}${r.DeedNo ? ` · deed ${r.DeedNo}` : ""}` : `${y}: not searched`}
                className={`h-8 border text-xs tabular-nums ${year === y ? "ring-2 ring-foreground" : ""} ${r?.Status === "Found" ? "border-emerald-700 bg-emerald-600/80 font-semibold text-white" : r ? "border-border bg-muted-foreground/25 text-muted-foreground" : "border-border bg-background hover:bg-muted"} disabled:cursor-default`}>
                {y}
              </button>
            );
          })}
        </div>
        {editable && (
          <div className="mt-2 flex flex-wrap gap-2">
            {!range && <button className={small} onClick={() => setRange({ from: String(first), to: String(thisYear), site: "" })}>Mark a range not found…</button>}
          </div>
        )}
        {range && (
          <div className="mt-2 flex flex-wrap items-end gap-2 border border-border bg-muted/30 p-2 text-xs">
            <label>From<select className={`${field} w-24`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })}>{[...allYears].reverse().map((y) => <option key={y}>{y}</option>)}</select></label>
            <label>To<select className={`${field} w-24`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })}>{allYears.map((y) => <option key={y}>{y}</option>)}</select></label>
            <label className="min-w-[14rem] flex-1">Government site checked<input className={field} value={range.site} placeholder="e.g. WB Registration (igr.wb.gov.in)" onChange={(e) => setRange({ ...range, site: e.target.value })} /></label>
            <button className="h-9 bg-foreground px-3 font-semibold text-card" onClick={saveRange}>Save as not found</button>
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
          <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Deeds found · {o.OfficeType}</p>
          <table className="w-full text-left text-xs">
            <tbody>
              {found.map((y) => (
                <tr key={y.SearchId} className="cursor-pointer border-t border-border first:border-t-0 hover:bg-muted/40" onClick={() => setYear(y.CalendarYear)}>
                  <td className="px-3 py-1.5 font-semibold tabular-nums">{y.CalendarYear}</td>
                  <td className="px-3 py-1.5"><b>Deed {y.DeedNo}</b>{y.DeedDate ? ` · ${y.DeedDate}` : ""}</td>
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
          {!done && <button className="bg-foreground px-4 py-2 text-sm font-semibold text-card" onClick={complete}>Mark {o.OfficeType} search complete</button>}
          {done && <button className={small} onClick={reopen}>Reopen {o.OfficeType} search</button>}
        </div>
      )}
    </div>
  );
}

function YearPanel({ year, r, editable, onSave, onDelete, onClose }: {
  year: number; r: YearResult | null; editable: boolean; onSave: (b: YearBody) => Promise<void>; onDelete?: () => void; onClose: () => void;
}) {
  const [result, setResult] = useState<"Found" | "Not Found">(r?.Status === "Not Found" ? "Not Found" : "Found");
  const [deedNo, setDeedNo] = useState(r?.DeedNo ?? "");
  const [deedDate, setDeedDate] = useState(r?.DeedDate ?? "");
  const [parties, setParties] = useState(r?.Parties ?? "");
  const [details, setDetails] = useState(r?.Details ?? "");
  const [siteName, setSiteName] = useState(r?.SiteName ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="border-2 border-foreground/70 bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold">{year}{r ? <span className="ml-2 text-xs font-normal text-muted-foreground">recorded{r.RecordedByName ? ` by ${r.RecordedByName}` : ""}</span> : <span className="ml-2 text-xs font-normal text-muted-foreground">not searched yet</span>}</p>
        <button className="text-xs underline" onClick={onClose}>Close</button>
      </div>
      <fieldset disabled={!editable} className="legal-g2">
        <div className="flex gap-2 legal-span">
          {(["Found", "Not Found"] as const).map((x) => (
            <button key={x} type="button" onClick={() => setResult(x)}
              className={`border px-4 py-1.5 text-sm font-semibold ${result === x ? (x === "Found" ? "border-emerald-700 bg-emerald-600 text-white" : "border-foreground bg-foreground text-card") : "border-border"}`}>{x}</button>
          ))}
        </div>
        {result === "Found" && (
          <>
            <label className="text-xs">Deed number *<input className={field} value={deedNo} maxLength={100} onChange={(e) => setDeedNo(e.target.value)} autoFocus /></label>
            <label className="text-xs">Deed date<input type="date" className={field} value={deedDate} onChange={(e) => setDeedDate(e.target.value)} /></label>
            <label className="text-xs legal-span">Parties (seller → buyer)<input className={field} value={parties} maxLength={500} onChange={(e) => setParties(e.target.value)} /></label>
          </>
        )}
        <label className="text-xs legal-span">Details<input className={field} value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} /></label>
        <label className="text-xs legal-span">Government site checked<input className={field} value={siteName} maxLength={200} placeholder="e.g. WB Registration (igr.wb.gov.in)" onChange={(e) => setSiteName(e.target.value)} /></label>
      </fieldset>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy || (result === "Found" && !deedNo.trim())} className="bg-foreground px-4 py-1.5 text-sm font-semibold text-card disabled:opacity-40"
            onClick={async () => { setBusy(true); await onSave({ result, deedNo, deedDate, parties, details, siteName }); setBusy(false); }}>
            Save {year}
          </button>
          {onDelete && <button className={`${small} text-rose-600`} onClick={onDelete}>Delete</button>}
        </div>
      )}
    </div>
  );
}
