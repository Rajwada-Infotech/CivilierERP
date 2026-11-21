import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SearchNormal1 } from "iconsax-react";
import { searchFlow } from "@/api/legalFlowApi";
import { Global } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { useProjectScope } from "@/components/legal/ProjectPicker";
import { LegalMasterTable } from "../LegalMasterPage";
import { legalMasterByKey } from "../legalMasters";
import type { LegalRow } from "@/api/legalMastersApi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { askLegal } from "@/components/legal/LegalAsk";
import { deleteLand } from "@/api/legalLandApi";
import { REGISTERED_LOCK } from "@/components/legal/LegalLock";

const BACKLOG = "Existing / Backlog"; // every land added here; enquiry-approved land is saved as New Acquisition

// Stage chips: where each land is in the pipeline.
const wf = (r: LegalRow) => String(r.WorkflowStatus ?? "");
const sold = (r: LegalRow) => r.LandStatus === "Disposed / Transferred" || r.LandStatus === "Inactive" || r.IsActive === false;
const FILTERS: Record<string, { label: string; test: (r: LegalRow) => boolean }> = {
  verification: { label: "Land conversion", test: (r) => !sold(r) && (!wf(r) || wf(r).startsWith("Draft")) },
  deed: { label: "Deed Process", test: (r) => !sold(r) && wf(r) === "Deed Process" },
  registration: { label: "Deed Registration", test: (r) => !sold(r) && (wf(r) === "Deed Completed" || wf(r) === "Deed Registration") },
  registered: { label: "Registered", test: (r) => !sold(r) && wf(r) === "Registered" },
  sold: { label: "Sold / Inactive", test: sold },
};
const stageLabel = (r: LegalRow) => (sold(r) ? "Sold / Inactive" : wf(r).startsWith("Draft") || !wf(r) ? "Land conversion" : wf(r) === "Deed Completed" ? "Deed Registration" : wf(r));
const STAGE_TONE: Record<string, string> = {
  "Land conversion": "border-amber-500/60 text-amber-700 dark:text-amber-400", "Deed Process": "border-sky-500/60 text-sky-700 dark:text-sky-400",
  "Deed Registration": "border-violet-500/60 text-violet-700 dark:text-violet-300", Registered: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400",
  "Sold / Inactive": "border-border text-muted-foreground",
};

/** Find any land by a number it is known by — Land ID, Enquiry no., RS / LR Khatian or Dag — and open its workspace. */
function FindLand() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, isFetching } = useQuery({ queryKey: ["legal-flow-search", term], queryFn: () => searchFlow(term), enabled: term.length > 0 });
  const hits = data?.results ?? [];
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  // A land opens its workspace (stage stepper, every tab); an enquiry not yet a land opens in Pipeline → Enquiries.
  const go = (h: { LandId: number | null; EnquiryId: number | null }) => {
    setOpen(false);
    navigate(h.LandId ? `/legal/land/properties/${h.LandId}` : `/legal/land/enquiries?edit=${h.EnquiryId}`);
  };
  return (
    <div className="relative z-40 mb-4" ref={box}>
      <div className="flex h-11 items-center gap-2 border-2 border-foreground/70 bg-background px-3 focus-within:border-foreground">
        <SearchNormal1 size={16} className="text-muted-foreground" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0]); if (e.key === "Escape") setOpen(false); }}
          placeholder="Find a land — Land ID, Enquiry no., RS / LR Khatian or Dag number"
          className="h-full flex-1 bg-transparent text-sm outline-none" />
        {isFetching && <span className="text-xs text-muted-foreground">Searching…</span>}
      </div>
      {open && term && !isFetching && (
        <ul className="absolute left-0 right-0 top-full z-50 max-h-80 overflow-y-auto border border-foreground bg-background shadow-lg">
          {!hits.length && <li className="px-3 py-2.5 text-sm text-muted-foreground">Nothing found for “{term}”.</li>}
          {hits.map((h) => (
            <li key={`${h.LandId}-${h.EnquiryId}`}>
              <button type="button" onClick={() => go(h)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left text-sm hover:bg-primary/5">
                <b className="font-mono">{h.LandCode ?? h.EnquiryNo}</b>
                <span>{h.LandName ?? h.EnquiryLocation}</span>
                <span className="text-xs text-muted-foreground">{h.LandId ? h.WorkflowStatus : `Enquiry · ${h.EnquiryStatus ?? ""}`}</span>
                <span className="text-xs font-semibold text-foreground">{h.LandId ? "Open land →" : "Open enquiry →"}</span>
                <span className="ml-auto text-xs text-muted-foreground">Matched: {h.Matched}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The central Company Land Register: every land property with its unique Land ID.
export default function LandPropertyListPage() {
  const entry = legalMasterByKey("land")!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filterKey = params.get("filter") ?? "";
  const filter = FILTERS[filterKey];
  const { inScope } = useProjectScope();
  const canDelete = usePageRights(entry.pageKey).canDelete;
  const queryClient = useQueryClient();

  // Deleting a land removes everything recorded on it, so the Land ID must be typed to confirm.
  const removeLand = async (raw: LegalRow) => {
    const code = String(raw.LandCode ?? "");
    const typed = await askLegal({
      title: `Delete ${code}?`,
      message: `This permanently removes ${code} (${String(raw.LandName ?? "")}) and everything recorded on it — ownership history, land records, documents and their files, legal records, loans, mutations, payments, tax receipts, valuations, photos and pipeline steps, and the enquiry it came from. This cannot be undone.`,
      input: { label: `Type ${code} to confirm`, placeholder: code, required: true },
      confirmText: "Delete land",
      tone: "danger",
    });
    if (typed === null) return;
    if (typed.trim() !== code) { toast.error(`The Land ID did not match — ${code} was not deleted`); return; }
    try {
      toast.success((await deleteLand(Number(raw.LandId), typed.trim())).message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the land");
    }
  };

  const set = (k: string, v: string | null) => {
    if (v) params.set(k, v);
    else params.delete(k);
    setParams(params);
  };

  const tabBtn = (on: boolean) =>
    `border px-2.5 py-1 text-xs font-heading font-semibold transition-colors ${
      on
        ? "border-foreground bg-foreground text-card"
        : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
    }`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Lands"]} />
      <LegalShell
        title="Lands"
        subtitle="Every company land, at every stage. Open a land to see and do everything for it in one place."
        icon={Global}
      >

        <FindLand />
        <p className="mb-3 border border-border px-3 py-2 text-xs text-muted-foreground">
          <b className="text-foreground">New Land Property</b> here is for land the company already owns (existing / backlog). Enter what
          you have; ownership history, documents, legal records, loans, mutations, payments and tax can be added later from the
          Land Profile. <b className="text-foreground">Buying new land?</b> Start it from{" "}
          <button className="underline hover:text-foreground" onClick={() => navigate("/legal/land/enquiries")}>Land Enquiries</button>{" "}
          — it joins this register as New Acquisition once converted.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Stage:</span>
          <button className={tabBtn(!filterKey)} onClick={() => set("filter", null)}>
            All Land
          </button>
          {Object.entries(FILTERS).map(([k, f]) => (
            <button key={k} className={tabBtn(filterKey === k)} onClick={() => set("filter", k)}>{f.label}</button>
          ))}
          {filter && (
            <span className="ml-2 text-xs text-muted-foreground">
              Showing: <b className="text-foreground">{filter.label}</b>{" "}
              <button className="ml-1 underline hover:text-foreground" onClick={() => set("filter", null)}>Clear</button>
            </span>
          )}
        </div>

        <LegalMasterTable
          entry={entry}
          requestEditId={params.get("edit")}
          rowLock={(r) => (r.WorkflowStatus === "Registered" && !Number(r.AmendmentOpen) ? REGISTERED_LOCK : null)}
          defaults={{ LandStatus: "Owned" }}
          // Land added here is land the company already owns; new purchases come in through Land Enquiries.
          fixed={{ EntryType: BACKLOG }}
          serverFilter={filterKey || undefined}
          projectScoped
          onCreated={(newId) => navigate(`/legal/land/properties/${newId}?tab=overview`)}
          rowActions={(raw) => (
            <span className="inline-flex items-center gap-1.5">
              <span className={`whitespace-nowrap border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] ${STAGE_TONE[stageLabel(raw)] ?? "border-border"}`}>{stageLabel(raw)}</span>
              <button
                onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)}
                className="rounded-md border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-muted"
                title="Open the land's workspace: stage, details, records, documents, versions"
              >
                Open
              </button>
              {raw.WorkflowStatus === "Registered" ? (
                <button
                  onClick={() => navigate("/legal/land/projects")}
                  className="rounded-md border border-indigo-500 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300"
                  title={REGISTERED_LOCK}
                >
                  Registered · Request amendment
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/legal/land/properties?edit=${raw.LandId}`)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Edit basic land information"
                >
                  Edit
                </button>
              )}
              {canDelete && raw.WorkflowStatus !== "Registered" && (
                <button
                  onClick={() => removeLand(raw)}
                  className="rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  title="Delete this land and all its records"
                >
                  Delete
                </button>
              )}
            </span>
          )}
        />
      </LegalShell>
    </>
  );
}
