import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageQuestion } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { PortalFetchButtons } from "@/components/legal/PortalFetch";
import { usePageRights } from "@/hooks/usePageRights";
import { convertEnquiry, setEnquiryStatus, getMyWhatsApp, setMyWhatsApp } from "@/api/legalLandApi";
import { askLegal } from "@/components/legal/LegalAsk";
import { LegalMasterTable } from "../LegalMasterPage";
import { getLegalRows, type LegalRow } from "@/api/legalMastersApi";
import { openLegalMap } from "@/components/legal/LegalDocumentPreview";
import { legalMasterByKey } from "../legalMasters";
import { ProjectPicker, useLegalProject } from "@/components/legal/ProjectPicker";

// Land enquiries: a new land opportunity. Converting one creates the Land ID and opens its Land Profile;
// a converted enquiry stays as it was, linked to its land.
export default function LandEnquiryPage() {
  const entry = legalMasterByKey("land-enquiry")!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const landRights = usePageRights("legal-land-master");
  const rights = usePageRights(entry.pageKey);
  const [projectId, setProjectId] = useLegalProject();
  const [filter, setFilter] = useState<string>("all");
  // The enquiry whose RS / LR records are open under the table (opens by itself after a new enquiry is saved).
  const [plotsId, setPlotsId] = useState<number | null>(null);
  // Same rows the table loads (shared cache): counts for the summary tiles.
  const { data: allRows = [] } = useQuery({ queryKey: ["legal-master", "land-enquiry", null], queryFn: () => getLegalRows("land-enquiry"), staleTime: 60 * 1000 });
  // Enquiries raised before a project was required belong to no project: they are listed apart ("Without a project")
  // so they never go missing — open one, set its project, and it moves under that project.
  // Scope: one project (remembered), "all" projects (the dashboard's figures cover every project) or "none" (enquiries
  // raised before a project was required). "all" / "none" come from the link or the picker and are not remembered.
  const [scope, setScope] = useState<"all" | "none" | null>(() => { const v = new URLSearchParams(window.location.search).get("project"); return v === "all" || v === "none" ? v : null; });
  const orphans = scope === "none";
  const setOrphans = (on: boolean) => setScope(on ? "none" : null);
  const isActive = (r: LegalRow) => r.IsActive !== false && r.IsActive !== 0;
  const orphanN = allRows.filter((r) => isActive(r) && (r.ProjectId == null || r.ProjectId === "")).length;
  const inScope = (r: LegalRow) => (scope === "all" ? true : orphans ? r.ProjectId == null || r.ProjectId === "" : Number(r.ProjectId) === projectId);
  const rows = allRows.filter((r) => inScope(r) && isActive(r));
  const FILTERS: [string, string, (r: LegalRow) => boolean, string][] = [
    ["all", "All", () => true, "border-border"],
    ["search", "Deed search pending", (r) => !r.LandId && Number(r.OfficesPending) > 0, "border-amber-500"],
    ["overdue", "Search overdue", (r) => !r.LandId && Number(r.OfficesOverdue) > 0, "border-destructive"],
    ["ready", "Ready to convert", (r) => !r.LandId && Number(r.OfficesPending) === 0 && !["Rejected", "On Hold"].includes(String(r.EnquiryStatus)), "border-emerald-600"],
    ["New", "New", (r) => r.EnquiryStatus === "New", "border-zinc-300"],
    ["Under Review", "Under review", (r) => r.EnquiryStatus === "Under Review", "border-sky-500"],
    ["Interested", "Interested", (r) => r.EnquiryStatus === "Interested", "border-emerald-500"],
    ["On Hold", "On hold", (r) => r.EnquiryStatus === "On Hold", "border-amber-500"],
    ["Rejected", "Rejected", (r) => r.EnquiryStatus === "Rejected", "border-rose-500"],
    ["converted", "Converted", (r) => !!r.LandId, "border-[#7c4a2e]"],
  ];
  const active = FILTERS.find((f) => f[0] === filter) ?? FILTERS[0];

  const convert = async (id: number, no: string) => {
    if (!(await askLegal({ title: `Convert enquiry ${no}?`, message: "A new Land ID is created and its Land Profile opens. The enquiry becomes read-only.", confirmText: "Land Conversion" }))) return;
    try {
      const r = await convertEnquiry(id);
      toast.success(r.message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      navigate(`/legal/land/properties/${r.landId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not convert");
    }
  };

  const changeStatus = async (id: number, no: string, status: "Rejected" | "On Hold" | "Under Review") => {
    let reason: string | undefined;
    if (status !== "Under Review") {
      const r = await askLegal({
        title: status === "Rejected" ? `Reject enquiry ${no}?` : `Put enquiry ${no} on hold?`,
        message: status === "Rejected" ? "It can be reopened later; it cannot be converted while rejected." : "It cannot be converted while on hold.",
        input: { label: "Reason", required: true },
        confirmText: status === "Rejected" ? "Reject" : "Put on hold", tone: status === "Rejected" ? "danger" : "default",
      });
      if (!r) return;
      reason = r;
    }
    try {
      toast.success((await setEnquiryStatus(id, status, reason)).message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the status");
    }
  };
  const small = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted";
  // Row tint and left edge by enquiry status, so the list reads at a glance.
  const STATUS_ROW: Record<string, string> = {
    "Under Review": "legal-enq-review",
    Interested: "legal-enq-interest",
    "On Hold": "legal-enq-hold",
    Rejected: "legal-enq-rejected",
    "Converted to Land Record": "legal-enq-converted",
  };


  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", entry.label]} />
      <LegalShell title={entry.label} subtitle="New land opportunities. Convert one to create its Land ID and Land Profile." icon={MessageQuestion}>
        <ProjectPicker value={scope ?? projectId} allowAll onChange={(id) => {
          // A choice made here replaces the one from the link.
          if (window.location.search) navigate("/legal/land/enquiries", { replace: true });
          if (id === "all" || id === "none") setScope(id); else { setScope(null); setProjectId(id); }
        }} />
        {orphanN > 0 && scope !== "none" && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm">
            <span><b>{orphanN} enquir{orphanN > 1 ? "ies have" : "y has"} no project</b> — raised before a project was required, so {orphanN > 1 ? "they don't" : "it doesn't"} show under any project but still count on the dashboard.</span>
            <button className="border border-foreground px-3 py-1 text-xs font-semibold hover:bg-muted" onClick={() => setOrphans(!orphans)}>Show them</button>
          </div>
        )}
        {(projectId || scope) && (
          <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
            {FILTERS.map(([k, label, test, edge]) => {
              const n = rows.filter(test).length;
              const hot = (k === "overdue" && n > 0);
              return (
                <button key={k} onClick={() => setFilter(k)}
                  className={`border border-l-4 ${edge} px-3 py-2 text-left transition-colors ${filter === k ? "bg-foreground text-card" : hot ? "bg-destructive/10" : "bg-card hover:bg-muted/50"}`}>
                  <span className={`block text-lg font-bold tabular-nums leading-none ${filter !== k && hot ? "text-destructive" : ""}`}>{n}</span>
                  <span className={`mt-1 block text-[0.6875rem] leading-tight ${filter === k ? "text-card/80" : "text-muted-foreground"}`}>{label}</span>
                </button>
              );
            })}
          </div>
        )}
        <MyWhatsAppPrompt />
        <div className="mb-4"><GovtSiteLinks hint="Before converting an enquiry, check the plot on the official site (opens in a new tab)." /></div>
        {projectId || scope ? (
        <LegalMasterTable
          key={scope ?? projectId ?? 0}
          entry={entry}
          // Only this project's enquiries; a new enquiry is raised under it.
          rowFilter={(raw) => inScope(raw) && active[2](raw)}
          // Without a project: no new enquiry here, and editing one asks for its project.
          // One project: a new enquiry is raised under it. All projects: the form asks for the project.
          fixed={scope ? undefined : { ProjectId: String(projectId) }}
          noAdd={orphans}
          addButton={orphans ? undefined : "Add Land Enquiry"}
          onCreated={(newId) => setPlotsId(newId)}
          rowClassName={(raw) => STATUS_ROW[String(raw.EnquiryStatus)]}
          // A converted enquiry is history: its details are kept and changed on the land it became.
          rowLock={(raw) => (raw.LandId ? `Converted to ${String(raw.LandCode ?? "a land")} — edit the land (Land Register → Edit), not the enquiry` : null)}
          rowActions={(raw) => {
            const id = Number(raw.EnquiryId);
            const no = String(raw.EnquiryNo);
            const st = String(raw.EnquiryStatus);
            // Latitude / longitude entered → open the plot on Google Maps.
            // Sites with an API switched on (Admin → API Integration): fetch this plot's details.
            const plots = (
              <button onClick={() => setPlotsId(plotsId === id ? null : id)} className={`${small} ${plotsId === id ? "bg-foreground text-card" : ""}`}
                title="RS and LR records (Khatian / Dag) of this enquiry">RS / LR{raw.RsDagNo || raw.LrDagNo ? "" : " · add"}</button>
            );
            const portal = <>{plots}<PortalFetchButtons title={no} values={{
              district: String(raw.DistrictId__label ?? ""), mouza: String(raw.MouzaId__label ?? "").replace(/\s*\(J\.L\..*\)$/, ""),
              jlNo: raw.JLNo as string, location: raw.LandLocation as string, lat: raw.GpsLatitude as number, lng: raw.GpsLongitude as number, enquiryNo: no,
            }} /></>;
            const map = raw.GpsLatitude != null && raw.GpsLongitude != null && (
              <button onClick={() => openLegalMap(raw.GpsLatitude, raw.GpsLongitude, `${no} · map`)} className={small} title="Show this plot on Google Maps in the side panel">Map</button>
            );
            if (raw.LandId) {
              return <span className="inline-flex gap-1.5">{map}{portal}<button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className={small}>Open land</button></span>;
            }
            if (!rights.canEdit) return <span className="inline-flex flex-wrap gap-1.5">{map}{portal}</span>;
            // Rejected / on hold: only Resume.
            if (st === "Rejected" || st === "On Hold") {
              return <span className="inline-flex gap-1.5">{map}{portal}<button onClick={() => changeStatus(id, no, "Under Review")} className={small}>Resume</button></span>;
            }
            // Hold / Reject are open at any stage (e.g. a wrong entry), even while the deed search is running.
            const holdReject = <>
              <button onClick={() => changeStatus(id, no, "On Hold")} className={small}>Hold</button>
              <button onClick={() => changeStatus(id, no, "Rejected")} className={`${small} text-rose-600`} title="Wrong entry or not interested: stops its deed search timelines">Reject</button>
            </>;
            // Deed Registry Search comes first: Convert / Hold / Reject open once every office's search is complete.
            // No office type set up for this enquiry's state: nothing to search yet, so it cannot be converted.
            if (Number(raw.OfficesTotal ?? 0) === 0 && st !== "Rejected") {
              return (
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  {map}{portal}
                  <button onClick={() => navigate("/legal/setup/registration-office-type")} className={`${small} border-amber-500 bg-amber-500/10 font-semibold text-amber-800`}
                    title="Add the registration office types of this state in Setup; the enquiry then gets its deed search timelines">No office type for this state — set up</button>
                  {holdReject}
                </span>
              );
            }
            const openOffices = Number(raw.OfficesPending ?? 0);
            if (openOffices > 0) {
              return (
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  {map}{portal}
                  <button onClick={() => navigate(`/legal/land/deed-search?view=all&q=${encodeURIComponent(no)}&project=${raw.ProjectId ?? "none"}`)} className={`${small} font-semibold ${Number(raw.OfficesOverdue) > 0 ? "border-destructive bg-destructive/10 text-destructive" : "border-amber-500 bg-amber-500/10 text-amber-800"}`}
                    title="Search every registration office first; the other actions open when all are complete">
                    Deed search {Number(raw.OfficesTotal ?? 0) - openOffices}/{Number(raw.OfficesTotal ?? 0)}{Number(raw.OfficesOverdue) > 0 ? ` · ${raw.OfficesOverdue} overdue` : ""}
                  </button>
                  {holdReject}
                </span>
              );
            }
            return (
              <span className="inline-flex flex-wrap justify-end gap-1.5">
                {map}
                {portal}
                {landRights.canCreate && <button onClick={() => convert(id, no)} className={small}>Land Conversion</button>}
                {holdReject}
              </span>
            );
          }}
        />
        ) : null}
        {projectId && plotsId && (() => {
          const e = allRows.find((r) => Number(r.EnquiryId) === plotsId);
          const locked = !!e?.LandId;
          const defaults = { MouzaId: String(e?.MouzaId ?? ""), AreaUnitId: String(e?.AreaUnitId ?? "") };
          return (
            <div id="enquiry-plots" className="mt-4 border-2 border-foreground/40 bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <p className="text-sm font-bold">RS / LR records · <span className="font-mono">{String(e?.EnquiryNo ?? "")}</span></p>
                  <p className="text-xs text-muted-foreground">{String(e?.LandLocation ?? "")} · total area {e?.ApproxArea != null ? String(e.ApproxArea) : "—"} · deed area {e?.DeedArea != null ? String(e.DeedArea) : "—"}
                    {locked ? " · converted: the records are on its land now" : " · add every Khatian / Dag this land covers; they go to the land on conversion"}</p>
                </div>
                <button className={small} onClick={() => setPlotsId(null)}>Close</button>
              </div>
              <div className="grid gap-4 p-4 xl:grid-cols-2">
                <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">RS (Revisional Survey) records</p>
                  <LegalMasterTable key={`rs-${plotsId}`} entry={{ ...entry, key: "enquiry-rs-record", label: "RS Record" }} parentId={plotsId} defaults={defaults} noAdd={locked}
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ["legal-master", "land-enquiry"] })} /></div>
                <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">LR (Land Reforms) records of rights</p>
                  <LegalMasterTable key={`lr-${plotsId}`} entry={{ ...entry, key: "enquiry-lr-record", label: "LR Record" }} parentId={plotsId} defaults={defaults} noAdd={locked}
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ["legal-master", "land-enquiry"] })} /></div>
              </div>
            </div>
          );
        })()}
        {!projectId && !scope && <p className="text-sm text-muted-foreground">Select a project to see and raise its land enquiries.</p>}
      </LegalShell>
    </>
  );
}

// Enquiries are assigned to whoever raises them, and others reach that person on WhatsApp. When the logged-in user has
// no WhatsApp number yet, ask for it here (saved on their own user).
function MyWhatsAppPrompt() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["my-whatsapp"], queryFn: getMyWhatsApp, staleTime: 5 * 60_000 });
  const [no, setNo] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data?.available || data.WhatsAppNo) return null;

  const save = async () => {
    setSaving(true);
    try {
      toast.success((await setMyWhatsApp(no)).message);
      await queryClient.invalidateQueries({ queryKey: ["my-whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["legal-master"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <span className="text-xs text-foreground">
        <b>Add your WhatsApp number</b> — enquiries you raise are assigned to you, and others use it to talk to you about them.
      </span>
      <input value={no} onChange={(e) => setNo(e.target.value)} type="tel" inputMode="tel" maxLength={20}
        placeholder="e.g. 9876543210" onKeyDown={(e) => e.key === "Enter" && no.trim() && save()}
        className="h-8 w-44 rounded-md border border-border bg-background px-2 text-xs" />
      <button onClick={save} disabled={saving || !no.trim()}
        className="h-8 rounded-md border border-foreground bg-foreground px-3 text-xs font-medium text-card disabled:opacity-50">
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
