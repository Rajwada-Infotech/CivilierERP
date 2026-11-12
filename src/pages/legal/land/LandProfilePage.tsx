import React, { useState } from "react";
import { openLegalMap } from "@/components/legal/LegalDocumentPreview";
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
              {TABS.map((t) => (
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
                      {QUICK_SECTIONS.filter((s) => c[s.count] > 0).length} of {QUICK_SECTIONS.length} sections have records · enter
                      information gradually in any order
                    </p>
                  </div>
                  <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {QUICK_SECTIONS.map((s, i) => {
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
            {tab === "transfers" && (
              <div className="space-y-6">
                <Section
                  title="Ownership Transfers & Acquisitions"
                  note="Historical record of how the land was acquired and transferred — purchase, inheritance, gift, partition — with deed numbers and registration dates."
                >
                  <LegalMasterTable entry={table("ownership-event", "Ownership Transfer")} parentId={landId} onSaved={refresh} />
                </Section>
                <Section
                  title="Purchase & Consideration Details"
                  note="Financial and contract details of property purchases: consideration price, advance amount, settlement, and payment proofs."
                >
                  <LegalMasterTable entry={table("land-purchase", "Purchase / Acquisition")} parentId={landId} onSaved={refresh}
                    rowActions={(raw) => childButton({ key: "payment", field: "TransactionId", id: Number(raw.TransactionId), title: `Payments · ${String(raw.TransactionNo ?? "purchase")}`, label: "Payments" }, payRows)} />
                </Section>
              </div>
            )}

            {/* TAB 5: LAND RECORDS (RS / LR) */}
            {tab === "records" && (
              <div className="space-y-6">
                <Section
                  title="Revisional Survey (RS) Records"
                  note="RS Khatian, RS Plot (Dag) numbers, recorded holder names, and land classifications."
                >
                  <LegalMasterTable entry={table("land-rs-record", "RS Record")} parentId={landId} onSaved={refresh} />
                </Section>
                <Section
                  title="Land Reforms (LR) Records of Rights (RoR)"
                  note="LR Khatian (Parcha), LR Plot (Dag) numbers, and mapping from old RS plots."
                >
                  <LegalMasterTable entry={table("land-lr-record", "LR Record of Rights")} parentId={landId} onSaved={refresh} />
                </Section>
              </div>
            )}

            {/* TAB 6: DOCUMENTS ARCHIVE */}
            {tab === "diligence" && <DueDiligencePanel landId={landId} onGoTab={(t) => setParams({ tab: t })} />}

            {tab === "documents" && (
              <Section
                title="Centralized Document Archive"
                note="Complete document storage for this property: Sale Deeds, Parent Deeds, Khatians, Mutation Certificates, Tax Receipts, Court Orders, Survey Reports, and Bank NOCs."
              >
                <DocumentsStep landId={landId} onSaved={refresh} />
              </Section>
            )}

            {/* TAB 7: LEGAL INFORMATION */}
            {tab === "legal" && (
              <div className="space-y-6">
                <Section
                  title="Court Cases & Disputes"
                  note="Past and ongoing court cases, plaintiffs, defendants, advocates, and case statuses."
                >
                  <LegalMasterTable entry={table("legal-case", "Court Case")} parentId={landId} onSaved={refresh}
                    rowActions={(raw) => childButton({ key: "case-hearing", field: "CaseId", id: Number(raw.CaseId), title: `Hearings · ${String(raw.CaseNumber ?? "case")}`, label: "Hearings" }, hearingRows)} />
                </Section>
                <Section
                  title="Legal Orders, Notices & Opinions"
                  note="Judgments, court orders, legal notices, legal opinions, and due-diligence clearance reports."
                >
                  <LegalMasterTable entry={table("land-legal-record", "Legal Record")} parentId={landId} onSaved={refresh}
                    rowActions={(raw) => docsButton({ kind: "legal", id: Number(raw.LegalRecordId), label: `${String(raw.RecordType ?? "Legal record")}${raw.CaseNumber ? ` ${String(raw.CaseNumber)}` : ""}` })} />
                </Section>
              </div>
            )}

            {/* TAB 8: LOAN & MORTGAGE */}
            {tab === "loans" && (
              <Section
                title="Loan & Mortgage History"
                note="Historical and active mortgages, bank loans, loan amounts, release dates, and bank NOCs. Closed loans are preserved."
              >
                <LegalMasterTable entry={table("mortgage", "Mortgage & Loan")} parentId={landId} onSaved={refresh}
                  rowActions={(raw) => docsButton({ kind: "loan", id: Number(raw.MortgageId), label: `${String(raw.LenderName ?? "Loan")}${raw.LoanAccountRef ? ` · ${String(raw.LoanAccountRef)}` : ""}` })} />
              </Section>
            )}

            {/* TAB 9: MUTATION RECORDS */}
            {tab === "mutation" && (
              <div className="space-y-6">
                <Section
                  title="Mutation Applications & Certificates"
                  note="BL&LRO mutation case numbers, previous and new owners, order dates, and certificate records."
                >
                  <LegalMasterTable entry={table("mutation", "Mutation")} parentId={landId} onSaved={refresh}
                    rowActions={(raw) => childButton({ key: "mutation-record", field: "MutationId", id: Number(raw.MutationId), title: `New Khatian / RoR · ${String(raw.ApplicationNo ?? raw.CaseNo ?? "mutation")}`, label: "New Khatian" }, khatianRows)} />
                </Section>
                <Section
                  title="New Khatian / RoR Post-Mutation"
                  note="New Khatian and plot records created by each mutation. Add one with New Khatian on its mutation's row above."
                >
                  <LegalMasterTable entry={table("mutation-record", "New Khatian / RoR")} parentId={landId} onSaved={refresh} noAdd />
                </Section>
              </div>
            )}

            {/* TAB 10: PAYMENT HISTORY */}
            {tab === "payments" && (
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
