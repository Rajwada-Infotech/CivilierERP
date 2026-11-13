import React, { useState } from "react";
import { openLegalMap, LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Global } from "iconsax-react";
import { FileText, Pencil } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import {
  getLandOverview,
  getLandAudit,
  type LandOverview,
} from "@/api/legalLandApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getDeedRegLand } from "@/api/legalDeedRegApi";
import { LegalMasterTable, WhatsAppName } from "../LegalMasterPage";
import { useAuth } from "@/contexts/AuthContext";
import { OwnershipStep } from "./steps/OwnershipStep";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { FinalVerifyBar } from "@/components/legal/FinalVerifyBar";
import { DueDiligencePanel } from "@/components/legal/DueDiligencePanel";
import { PortalFetchButtons } from "@/components/legal/PortalFetch";
import { DocumentsStep, RecordDocuments, type DocLink } from "./steps/DocumentsStep";
import { getLandDocuments } from "@/api/legalDocumentsApi";
import { getLegalRows, type LegalRow } from "@/api/legalMastersApi";

// The Central Land Details Profile: complete property record, one page per Land ID.
// Every section maintains historical records linked directly to this property.

const LAND_PAGE = "legal-land-master";
const table = (key: string, label: string) => ({ pageKey: LAND_PAGE, key, label });

type TabKey =
  | "overview"
  | "basic"
  | "ownership"
  | "transfers"
  | "records"
  | "documents"
  | "diligence"
  | "legal"
  | "loans"
  | "mutation"
  | "payments"
  | "tax"
  | "survey"
  | "photos"
  | "activity";

const TABS: { key: TabKey; label: string; count?: keyof LandOverview["counts"] }[] = [
  { key: "overview", label: "Overview" },
  { key: "basic", label: "Basic Information" },
  { key: "ownership", label: "Ownership History", count: "ownershipRecords" },
  { key: "transfers", label: "Acquisition & Purchase", count: "transfers" },
  { key: "records", label: "Land Records (RS / LR)", count: "landRecords" },
  { key: "legal", label: "Legal Dispute Information", count: "legalHistory" },
  { key: "loans", label: "Loan & Mortgage", count: "mortgages" },
  { key: "mutation", label: "Mutation Records", count: "mutations" },
  { key: "payments", label: "Payment History", count: "payments" },
  { key: "tax", label: "Land Tax (Khajna)", count: "taxRecords" },
  { key: "survey", label: "Survey & Valuation", count: "valuations" },
  // Each section uploads its own documents; this tab is for everything else (and lists them all).
  { key: "documents", label: "Other Documents", count: "documents" },
  { key: "diligence", label: "Due Diligence" },
  { key: "photos", label: "Notes & Attachments" },
  { key: "activity", label: "Activity History" },
];

const QUICK_SECTIONS: { tab: TabKey; label: string; count: keyof LandOverview["counts"]; hint: string }[] = [
  { tab: "ownership", label: "Ownership History", count: "ownershipRecords", hint: "Earliest known owner, then every change up to the company" },
  { tab: "transfers", label: "Acquisition & Purchase", count: "transfers", hint: "Sale deed numbers, dates, purchase price & consideration" },
  { tab: "records", label: "Land Records (RS / LR)", count: "landRecords", hint: "RS and LR Khatian / Dag entries and mappings" },
  { tab: "documents", label: "Documents Archive", count: "documents", hint: "Deeds, khatian copies, mutation orders, tax receipts" },
  { tab: "legal", label: "Legal Dispute Information", count: "legalHistory", hint: "Court cases, dispute records, orders, notices, legal opinions" },
  { tab: "loans", label: "Loan & Mortgage", count: "mortgages", hint: "Past and current bank loans and mortgages on this land" },
  { tab: "mutation", label: "Mutation Records", count: "mutations", hint: "Each mutation application, case number, and order" },
  { tab: "payments", label: "Payment History", count: "payments", hint: "Past payments, advances, and final settlements for the land" },
  { tab: "tax", label: "Land Tax (Khajna)", count: "taxRecords", hint: "Land revenue and khajna receipts year by year" },
  { tab: "survey", label: "Survey & Valuation", count: "valuations", hint: "Boundary surveys, maps, and market valuation reports" },
];

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const box = "border border-border p-4";
const label = "text-[0.625rem] font-heading font-semibold uppercase tracking-[0.12em] text-muted-foreground";

const Field: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="min-w-0">
    <p className={label}>{k}</p>
    <p className="mt-0.5 break-words text-sm text-foreground">{v === null || v === undefined || v === "" ? "—" : v}</p>
  </div>
);

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="space-y-2">
    <div>
      <p className="label">{title}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
    {children}
  </section>
);

const Activity: React.FC<{ landId: number }> = ({ landId }) => {
  const { data, isLoading } = useQuery({ queryKey: ["legal-land-audit", landId], queryFn: () => getLandAudit(landId) });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            {["When", "Who", "Action", "Record", "Remarks"].map((h) => (
              <th key={h} className="px-2 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.EventId}>
              <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{new Date(a.CreatedAt).toLocaleString("en-IN")}</td>
              <td className="px-2 py-2">{a.UserName ?? "—"}{a.UserRole ? <span className="block text-[0.6875rem] text-muted-foreground">{a.UserRole}</span> : null}</td>
              <td className="px-2 py-2">{a.Action}</td>
              <td className="px-2 py-2 text-xs text-muted-foreground">
                {a.EntityType}
                {a.EntityId ? ` #${a.EntityId}` : ""}
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground">{a.Remarks ?? ""}{a.DocumentRef ? <span className="block">Document: {a.DocumentRef}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function LandProfilePage() {
  const { id } = useParams();
  const landId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "overview") as TabKey;
  const setTab = (t: TabKey) => {
    params.set("tab", t);
    setParams(params, { replace: true });
  };

  const { data, error, isLoading } = useQuery({
    queryKey: ["legal-land-overview", landId],
    queryFn: () => getLandOverview(landId),
    enabled: landId > 0,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["legal-land-overview", landId] });
    queryClient.invalidateQueries({ queryKey: ["legal-land-audit", landId] });
    queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
    queryClient.invalidateQueries({ queryKey: ["legal-land-final", landId] });
  };

  // Documents filed under a legal record / loan: opened from that row, counted per row.
  const [docsFor, setDocsFor] = useState<DocLink | null>(null);
  const { data: landDocs } = useQuery({ queryKey: ["legal-land-docs", landId], queryFn: () => getLandDocuments(landId), enabled: landId > 0 });
  const docCount = (kind: DocLink["kind"], id: number) =>
    (landDocs?.documents ?? []).filter((d) => (kind === "legal" ? d.RelatedLegalRecordId : d.RelatedMortgageId) === id).length;
  const docsButton = (link: DocLink) => (
    <button onClick={(e) => { e.stopPropagation(); setDocsFor(link); }} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
      Documents ({docCount(link.kind, link.id)})
    </button>
  );
  // Child records are added from their parent's row: payments under a purchase / sale, new Khatian under its
  // mutation, hearings under their court case. The dialog lists that parent's children with the parent fixed.
  type Child = { key: string; field: string; id: number; title: string; label: string };
  const [child, setChild] = useState<Child | null>(null);
  const childRows = (key: string) => getLegalRows(key, landId);
  const { data: payRows } = useQuery({ queryKey: ["legal-master", "payment", landId], queryFn: () => childRows("payment"), enabled: landId > 0 });
  const { data: khatianRows } = useQuery({ queryKey: ["legal-master", "mutation-record", landId], queryFn: () => childRows("mutation-record"), enabled: landId > 0 });
  const { data: hearingRows } = useQuery({ queryKey: ["legal-master", "case-hearing", landId], queryFn: () => childRows("case-hearing"), enabled: landId > 0 });
  const childButton = (c: Child, rows: LegalRow[] | undefined) => (
    <button onClick={(e) => { e.stopPropagation(); setChild(c); }} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
      {c.label} ({(rows ?? []).filter((r) => Number(r[c.field]) === c.id).length})
    </button>
  );
  const land = data?.land;
  // The chain: a land bought through the module (New Acquisition) gets its consideration and payments at Deed
  // Registration, after L1 / L2 approval — not here. Here (the land's history) they are kept only for existing / backlog
  // land the company bought before, from its old file.
  const ownPurchaseHere = !!land && land.EntryType !== "New Acquisition";
  // Acquisition & Purchase: for a new acquisition it is the company's purchase, so it appears only once the deed is
  // registered — as a read-only record built from Deed Registration. Earlier transfers live in Ownership History.
  const registered = land?.WorkflowStatus === "Registered";
  const tabs = TABS.filter((t) => (t.key !== "payments" || ownPurchaseHere) && (t.key !== "transfers" || ownPurchaseHere || registered));
  const quickSections = QUICK_SECTIONS.filter((s) => (s.tab !== "payments" && s.tab !== "transfers") || ownPurchaseHere);
  const { currentUser } = useAuth();
  const isAdminTier = ["super_admin", "admin", "dba"].includes(currentUser?.role ?? "");
  const c = data?.counts;
  const btn = "inline-flex items-center gap-1.5 border border-foreground px-3 py-1.5 text-xs font-heading font-semibold uppercase tracking-[0.08em] hover:bg-primary/10";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Register", land ? land.LandCode : "Property"]} />
      <LegalShell
        title={land ? `${land.LandCode} · ${land.LandName}` : "Property"}
        subtitle={
          land
            ? `${land.MouzaName ?? "—"}${land.JLNo ? ` (J.L. ${land.JLNo})` : ""} · ${land.DistrictName ?? "—"} · ${
                land.Area ?? "—"
              } ${land.UnitName ?? ""}`
            : undefined
        }
        icon={Global}
        action={
          land && (
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => navigate(`/legal/land/properties?edit=${landId}`)}>
                <Pencil size={13} /> Edit basic info
              </button>
              <button className={btn} onClick={() => navigate(`/legal/land/properties/${landId}/details`)}>
                <FileText size={13} /> Full report & PDF
              </button>
            </div>
          )
        }
      >
        {error && <p className="text-sm text-destructive">Could not load this land property: {(error as Error).message}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading land property profile…</p>}
        {land && c && (
          <div className="space-y-5">

            {/* Modal: Action confirmation dialog */}
            <Dialog open={!!child} onOpenChange={(o) => { if (!o) setChild(null); }}>
              <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{child?.title}</DialogTitle>
                  <DialogDescription>Records belonging to this one only; a new one is added under it.</DialogDescription>
                </DialogHeader>
                {child && (
                  <LegalMasterTable key={`${child.key}-${child.id}`} entry={table(child.key, child.label)} parentId={landId} onSaved={refresh}
                    fixed={{ [child.field]: String(child.id) }} rowFilter={(r) => Number(r[child.field]) === child.id} />
                )}
              </DialogContent>
            </Dialog>
            <Dialog open={!!docsFor} onOpenChange={(o) => { if (!o) setDocsFor(null); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Documents · {docsFor?.label}</DialogTitle>
                  <DialogDescription>Documents filed under this {docsFor?.kind === "loan" ? "loan / mortgage" : "legal record"}. They also show on the Documents tab.</DialogDescription>
                </DialogHeader>
                {docsFor && <RecordDocuments landId={landId} link={docsFor} onSaved={refresh} />}
              </DialogContent>
            </Dialog>
            {/* 14 tabs: one swipeable row on phones, wrapped on wider screens */}
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 whitespace-nowrap border px-2.5 py-1.5 text-xs font-heading font-semibold transition-colors ${
                    tab === t.key
                      ? "border-foreground bg-foreground text-card"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && c[t.count] !== undefined ? (
                    <span className="ml-1 tabular-nums opacity-70">({c[t.count]})</span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* TAB 1: OVERVIEW */}
            {tab === "overview" && (
              <div className="space-y-4">
                {/* Basic property summary card */}
                <div className={`${box} grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`}>
                  <Field k="Land ID" v={land.LandCode} />
                  <Field k="Property title" v={land.LandName} />
                  <Field k="Entry type" v={land.EntryType} />
                  <Field k="Land status" v={land.LandStatus} />
                  <Field k="Possession" v={land.PossessionStatus ?? "In Possession"} />
                  <Field k="Acquisition type" v={land.AcquisitionType || "Purchase"} />
                  <Field
                    k="Acquisition date"
                    v={
                      land.AcquisitionDate
                        ? `${fmtDate(land.AcquisitionDate)}${land.AcquisitionDateApprox ? " (approx.)" : ""}`
                        : "Not recorded"
                    }
                  />
                  <Field k="Software entry date" v={fmtDate(land.CreatedAt)} />
                {land.EnquiryNo && (
                  <Field k="Entry by" v={<span className="inline-flex flex-wrap items-center gap-1.5">
                    <WhatsAppName name={land.EnquiryByName} phone={land.EnquiryByWhatsApp} userId={land.EnquiryById ?? null}
                      canSet={isAdminTier || String(land.EnquiryById ?? "") === String(currentUser?.id ?? "")} onSaved={refresh} />
                    <span className="text-xs text-muted-foreground">({land.EnquiryNo})</span>
                  </span>} />
                )}
                  <Field k="Location" v={land.LocationAddress ?? `${land.MouzaName ?? ""}${land.JLNo ? ` (J.L. ${land.JLNo})` : ""}`} />
                  <Field k="Total area" v={land.Area !== null ? `${land.Area} ${land.UnitName ?? ""}` : null} />
                  <Field k="District" v={land.DistrictName} />
                  <Field k="Last updated" v={fmtDate(land.LastUpdated)} />
                </div>

                {/* Current Recorded Owner(s) */}
                <div className={box}>
                  <p className={label}>Current Recorded Owner(s)</p>
                  {data.owners.length ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {data.owners.map((o, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{o.OwnerName ?? "—"}</span>
                          <span className="text-muted-foreground">
                            {Number(o.SharePct)}% share since {fmtDate(o.ValidFrom)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">No owner recorded yet — add ownership history.</p>
                  )}
                </div>

                {/* Summary Metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {([
                    ["Active court cases", c.activeCases, "legal"],
                    ["Active mortgages", c.activeMortgages, "loans"],
                    ["Documents", c.documents, "documents"],
                    ["Documents pending verification", c.documentsUnverified, "documents"],
                    ["Ownership records", c.ownershipRecords, "ownership"],
                    ["Tax receipts", c.taxRecords, "tax"],
                  ] as const).map(([k, v, t]) => (
                    <button key={k} onClick={() => setTab(t)} className={`${box} text-left hover:bg-primary/5 transition-colors`}>
                      <p className="text-2xl font-heading font-bold tabular-nums text-foreground">{v}</p>
                      <p className="mt-1 text-[0.6875rem] leading-tight text-muted-foreground">{k}</p>
                    </button>
                  ))}
                </div>

                {/* Quick Section Navigator */}
                <div className={box}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="label">Land Information Sections — Complete Property Record</p>
                    <p className="text-xs text-muted-foreground">
                      {quickSections.filter((s) => c[s.count] > 0).length} of {quickSections.length} sections have records · enter
                      information gradually in any order
                    </p>
                  </div>
                  <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {quickSections.map((s, i) => {
                      const done = c[s.count] > 0;
                      return (
                        <li key={s.tab}>
                          <button
                            onClick={() => setTab(s.tab)}
                            className={`flex w-full items-start gap-2.5 border px-3 py-2 text-left hover:bg-primary/5 transition-colors ${
                              done ? "border-border" : "border-foreground"
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[0.625rem] font-bold ${
                                done ? "bg-foreground text-card" : "border border-foreground text-foreground"
                              }`}
                            >
                              {done ? "✓" : i + 1}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">
                                {s.label}
                                {done ? <span className="ml-1 font-normal text-muted-foreground">· {c[s.count]}</span> : null}
                              </span>
                              <span className="block text-xs text-muted-foreground">{done ? "Records added" : s.hint}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <GovtSiteLinks />
              </div>
            )}

            {/* TAB 2: BASIC INFORMATION */}
            {tab === "basic" && (
              <div className={`${box} grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
                <Field k="Land ID" v={land.LandCode} />
                <Field k="Property title" v={land.LandName} />
                <Field k="Entry type" v={land.EntryType} />
                <Field k="District" v={land.DistrictName} />
                <Field k="Sub-division" v={land.SubDivisionName} />
                <Field k="Block" v={land.BlockName} />
                <Field k="Mouza" v={land.MouzaName} />
                <Field k="J.L. number" v={land.JLNo} />
                <Field k="RS Dag / Plot" v={land.RsDagNo} />
                <Field k="LR Dag / Plot" v={land.LrDagNo} />
                <Field k="RS Khatian" v={land.RsKhatianNo} />
                <Field k="LR Khatian" v={land.LrKhatianNo} />
                <Field k="Total land area" v={land.Area !== null ? `${land.Area} ${land.UnitName ?? ""}` : null} />
                <Field k="Land classification" v={land.LandTypeName} />
                <Field k="Land status" v={land.LandStatus} />
                <Field k="Possession status" v={land.PossessionStatus ?? "In Possession"} />
                <Field k="Acquisition type" v={land.AcquisitionType || "Purchase"} />
                <Field
                  k="Acquisition date"
                  v={
                    land.AcquisitionDate
                      ? `${fmtDate(land.AcquisitionDate)}${land.AcquisitionDateApprox ? " (approx.)" : ""}`
                      : null
                  }
                />
                <Field k="Software entry date" v={fmtDate(land.CreatedAt)} />
                {land.EnquiryNo && (
                  <Field k="Entry by" v={<span className="inline-flex flex-wrap items-center gap-1.5">
                    <WhatsAppName name={land.EnquiryByName} phone={land.EnquiryByWhatsApp} userId={land.EnquiryById ?? null}
                      canSet={isAdminTier || String(land.EnquiryById ?? "") === String(currentUser?.id ?? "")} onSaved={refresh} />
                    <span className="text-xs text-muted-foreground">({land.EnquiryNo})</span>
                  </span>} />
                )}
                <Field k="North boundary" v={land.NorthBoundary} />
                <Field k="South boundary" v={land.SouthBoundary} />
                <Field k="East boundary" v={land.EastBoundary} />
                <Field k="West boundary" v={land.WestBoundary} />
                <Field
                  k="GPS coordinates"
                  v={land.GpsLatitude != null && land.GpsLongitude != null ? (
                    <>
                      {`${land.GpsLatitude}, ${land.GpsLongitude}`}{" "}
                      <button className="ml-1 text-xs underline" onClick={() => openLegalMap(land.GpsLatitude, land.GpsLongitude, `${land.LandCode} · map`)}>Map</button>
                    </>
                  ) : (
                    <button className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => navigate(`/legal/land/properties?edit=${landId}`)}>
                      Not set — add latitude / longitude
                    </button>
                  )}
                />
                <Field k="Full location address" v={land.LocationAddress} />
                <Field k="Internal remarks" v={land.Remarks} />
                <Field k="Fetch from government site" v={<PortalFetchButtons landId={landId} title={land.LandCode} values={{
                  district: land.DistrictName, mouza: land.MouzaName, jlNo: land.JLNo, location: land.LocationAddress, lat: land.GpsLatitude, lng: land.GpsLongitude,
                  rsDag: land.RsDagNo, lrDag: land.LrDagNo, rsKhatian: land.RsKhatianNo, lrKhatian: land.LrKhatianNo, landCode: land.LandCode,
                }} />} />
                <div className="sm:col-span-2 lg:col-span-3 pt-2">
                  <button className={btn} onClick={() => navigate(`/legal/land/properties?edit=${landId}`)}>
                    <Pencil size={13} /> Edit basic information
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: OWNERSHIP HISTORY */}
            {tab === "ownership" && (
              <Section
                title="Complete Ownership History"
                note="Maintain all previous and current owners from the earliest known owner to today. Adding a new owner closes the previous period without overwriting history."
              >
                <OwnershipStep landId={landId} onSaved={refresh} />
              </Section>
            )}

            {/* TAB 4: ACQUISITION & PURCHASE DETAILS */}
            {tab === "transfers" && ownPurchaseHere && (
              <div className="space-y-6">
                <Section
                  title="Ownership Transfers & Acquisitions"
                  note="Historical record of how the land was acquired and transferred — purchase, inheritance, gift, partition — with deed numbers and registration dates."
                >
                  <LegalMasterTable entry={table("ownership-event", "Ownership Transfer")} parentId={landId} onSaved={refresh} />
                </Section>
                <Section
                  title="Purchase & Consideration Details"
                  note="The company's earlier purchase of this land (from its old file): consideration price, advance, settlement and payment proofs."
                >
                  <LegalMasterTable entry={table("land-purchase", "Purchase / Acquisition")} parentId={landId} onSaved={refresh}
                    rowActions={(raw) => childButton({ key: "payment", field: "TransactionId", id: Number(raw.TransactionId), title: `Payments · ${String(raw.TransactionNo ?? "purchase")}`, label: "Payments" }, payRows)} />
                </Section>
              </div>
            )}
            {tab === "transfers" && !ownPurchaseHere && registered && <AcquisitionRecord landId={landId} onOpen={() => navigate("/legal/deed-registration")} />}

            {/* TAB 10: PAYMENT HISTORY */}
            {tab === "payments" && ownPurchaseHere && (
              <Section
                title="Payment & Transaction History"
                note="Historical financial payments for this land: advances, installments, and final settlements with payment modes and references."
              >
                <LegalMasterTable entry={table("payment", "Payment")} parentId={landId} onSaved={refresh} />
              </Section>
            )}

            {/* TAB 11: LAND TAX (KHAJNA) */}
            {tab === "tax" && (
              <Section
                title="Land Revenue & Tax (Khajna) History"
                note="Year-by-year land tax payments, receipt numbers, payment dates, amounts, and receipt uploads."
              >
                <LegalMasterTable entry={table("land-tax", "Land Tax (Khajna)")} parentId={landId} onSaved={refresh} />
              </Section>
            )}

            {/* TAB 12: SURVEY & VALUATION */}
            {tab === "survey" && (
              <Section
                title="Survey & Valuation Records"
                note="Land survey reports, physical boundary checks, survey maps, and historical property valuation estimates."
              >
                <LegalMasterTable entry={table("valuation", "Valuation & Survey")} parentId={landId} onSaved={refresh} />
              </Section>
            )}

            {/* TAB 13: NOTES & ATTACHMENTS */}
            {tab === "photos" && (
              <Section
                title="Site Photographs, Maps & Notes"
                note="Photographs of the land property, boundary markers, site maps, and internal notes."
              >
                <LegalMasterTable entry={table("land-photo", "Land Photo")} parentId={landId} onSaved={refresh} />
              </Section>
            )}

            {/* TAB 14: ACTIVITY HISTORY */}
            {tab === "activity" && (
              <Section
                title="Activity & Audit Trail"
                note="Complete system audit history: who entered, modified, or updated records on this land, with timestamped logs."
              >
                <Activity landId={landId} />
              </Section>
            )}

            {/* All data entered → the verifier checks everything on one page and sends the land to Deed Process. */}
            <FinalVerifyBar landId={landId} />
          </div>
        )}
      </LegalShell>
    </>
  );
}

/**
 * The company's acquisition of a new-acquisition land, read-only, after registration: everything comes from Deed
 * Registration (consideration and its revisions, payments, stamp duty, final registration, the registered deed and the
 * physical deed / IGR status). It is changed there, never typed again here.
 */
function AcquisitionRecord({ landId, onOpen }: { landId: number; onOpen: () => void }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["legal-deed-reg-land", landId], queryFn: () => getDeedRegLand(landId) });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  const l = data.land;
  const stamp = data.queries.reduce((a, q) => a + Number(q.Amount), 0);
  const box = "border border-border bg-card p-4";
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 border-t border-border py-1.5 text-sm first:border-t-0"><span className="text-muted-foreground">{k}</span><span className="text-right font-semibold">{v}</span></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-emerald-600/40 bg-emerald-600/5 px-4 py-3">
        <div>
          <p className="text-sm font-bold">Acquired by the company — deed {l.RegDeedNo ?? "—"}{l.RegFinalDate ? ` registered ${l.RegFinalDate}` : ""}</p>
          <p className="text-xs text-muted-foreground">Read-only record from Deed Registration. The transfer to the company is also in Ownership History.</p>
        </div>
        <button className="border border-foreground px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={onOpen}>Open in Deed Registration</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={box}>
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Consideration & payment</p>
          {row("Consideration", inrFmt(l.ConsTotalAmount))}
          {row("Agreed on", l.ConsDate ?? "—")}
          {row("Paid", inrFmt(l.Paid))}
          {row("Last payment", l.LastPaid ?? "—")}
          {row("Stamp duty & fees", inrFmt(stamp))}
          {data.revisions.length > 1 && row("Price revisions", `${data.revisions.length - 1}`)}
        </div>
        <div className={box}>
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Registration</p>
          {row("Date", l.RegFinalDate ?? "—")}
          {row("Office", l.RegOffice ?? "—")}
          {row("Mode", l.RegMode ?? "—")}
          {row("Deed number", l.RegDeedNo ?? "—")}
          {row("Registered deed", l.RegDeedFileId ? <LegalFileLink id={l.RegDeedFileId} name={l.RegDeedFileName ?? "Registered deed"} /> : "—")}
          {row("Physical deed", `${l.IgrStatus ?? "—"} · ${l.DeedLocation ?? "—"}`)}
        </div>
      </div>
      {data.payments.length > 0 && (
        <div className={box}>
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Payments</p>
          {data.payments.map((pm) => row(`${pm.PaymentDate} · ${pm.Purpose ?? "Payment"}${pm.Mode ? ` · ${pm.Mode}` : ""}`, `${pm.Purpose === "Refund" ? "−" : ""}${inrFmt(pm.Amount)}`))}
        </div>
      )}
    </div>
  );
}
const inrFmt = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
