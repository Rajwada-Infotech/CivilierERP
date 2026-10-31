import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DocumentText } from "iconsax-react";
import { ArrowLeft, Download } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell, LEGAL_ACCENT } from "@/components/legal/LegalShell";
import { getLandDossier } from "@/api/legalLandApi";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";

// Everything recorded on one land property, section by section, on one page. "Download PDF" prints just this
// sheet (the browser's Save as PDF), so the PDF always matches what is on screen.

type Row = Record<string, unknown>;
const STEP_STYLE: Record<string, string> = {
  Completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  "In Progress": "border-sky-500/40 bg-sky-500/10 text-sky-600",
  "Pending Verification": "border-amber-500/40 bg-amber-500/10 text-amber-600",
  "Correction Required": "border-rose-500/40 bg-rose-500/10 text-rose-600",
  Skipped: "border-border bg-muted text-muted-foreground",
};
const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const cell = (v: unknown): React.ReactNode =>
  v === null || v === undefined || v === "" ? "—"
    : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDate(v)
    : typeof v === "number" ? v.toLocaleString("en-IN") : String(v);

/** A section; `step` links it to its pipeline step on the land's page. */
const Section: React.FC<{ title: string; step?: string; landId?: number; children: React.ReactNode }> = ({ title, step, landId, children }) => {
  const navigate = useNavigate();
  return (
    <section className="break-inside-avoid border-t border-border pt-4 print:pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-heading font-semibold uppercase tracking-[0.16em]" style={{ color: LEGAL_ACCENT }}>{title}</h3>
        {step && landId ? (
          <button className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline print:hidden" onClick={() => navigate(`/legal/land/properties/${landId}?step=${step}`)}>
            Open in pipeline →
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
};

const Table: React.FC<{ rows: Row[]; cols: [string, string][]; empty?: string }> = ({ rows, cols, empty = "None recorded." }) =>
  !rows.length ? <p className="text-sm text-muted-foreground">{empty}</p> : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{cols.map(([, h]) => <th key={h} className="whitespace-nowrap pb-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-t border-border/60 align-top">
            {cols.map(([k]) => (
              <td key={k} className="py-1.5 pr-3">
                {/* A "File" column opens the document in the side panel (on paper: its name). */}
                {k === "DocFileId" ? (r.DocFileId ? <><span className="print:hidden"><LegalFileLink id={r.DocFileId} name={String(r.DocFileName ?? "")} /></span><span className="hidden print:inline">{String(r.DocFileName ?? "")}</span></> : "—") : cell(r[k])}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

export default function LandDetailsPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-land-dossier", id], queryFn: () => getLandDossier(id), enabled: id > 0 });
  const print = () => {
    document.body.classList.add("legal-printing");
    const done = () => { document.body.classList.remove("legal-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };
  const L = data?.land ?? {};
  const kv = (k: string, v: unknown) => <div><dt className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="text-sm text-foreground">{cell(v)}</dd></div>;
  const current = (data?.owners ?? []).filter((o) => !o.ValidTo);

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Land Properties", path: "/legal/land/properties" }, { label: String(L.LandCode ?? "…"), path: `/legal/land/properties/${id}` }, { label: "Full details" }]} />
      <LegalShell
        title={`${String(L.LandCode ?? "")} · ${String(L.LandName ?? "")}`}
        subtitle="Everything recorded on this land"
        icon={DocumentText}
        action={
          <div className="flex gap-2 print:hidden">
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => navigate(`/legal/land/properties/${id}`)}><ArrowLeft size={13} /><span className="hidden sm:inline">Pipeline</span></button>
            <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: LEGAL_ACCENT }} disabled={!data} onClick={print}><Download size={13} /> Download PDF</button>
          </div>
        }
      >
        {error ? <p className="p-6 text-destructive">{(error as Error).message}</p> : isLoading || !data ? <p className="p-6 text-muted-foreground">Loading…</p> : (
          <div className="legal-print space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-6 print:border-0 print:p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-heading font-bold text-foreground">{String(L.LandCode)} — {String(L.LandName)}</h2>
              <span className="text-xs text-muted-foreground">Printed {fmtDate(new Date().toISOString())} · CivilierERP Legal</span>
            </div>

            <Section title="Property" step="PROPERTY" landId={id}>
              <dl className="grid gap-3 sm:grid-cols-3">
                {kv("Mouza (J.L.)", L.MouzaName ? `${L.MouzaName} (${L.JLNo ?? "-"})` : null)}
                {kv("District", L.DistrictName)}
                {kv("Sub-division / Block", [L.SubDivisionName, L.BlockName].filter(Boolean).join(" / "))}
                {kv("Village / Police station", [L.VillageName, L.StationName].filter(Boolean).join(" / "))}
                {kv("Municipality", L.Municipality)}
                {kv("Area", L.Area != null ? `${Number(L.Area)} ${L.UnitName ?? ""}` : null)}
                {kv("Land type", L.LandTypeName)}
                {kv("Land status", L.LandStatus)}
                {kv("Workflow", L.IsCancelled ? "Cancelled" : L.IsOnHold ? "On hold" : L.WorkflowStatus)}
                {kv("Address", L.LocationAddress)}
                {kv("Boundaries N / S", [L.NorthBoundary, L.SouthBoundary].filter(Boolean).join(" / "))}
                {kv("Boundaries E / W", [L.EastBoundary, L.WestBoundary].filter(Boolean).join(" / "))}
                {kv("GPS", L.GpsLatitude ? `${L.GpsLatitude}, ${L.GpsLongitude}` : null)}
                {kv("From enquiry", L.EnquiryNo)}
              </dl>
            </Section>

            <Section title="Current owners" step="OWNERSHIP" landId={id}>
              <Table rows={current} cols={[["OwnerName", "Owner"], ["OwnerGuardian", "Father / husband"], ["SharePct", "Share %"], ["ValidFrom", "Since"], ["VerificationStatus", "Verification"]]} />
            </Section>
            <Section title="Ownership chain" step="OWNERSHIP" landId={id}>
              <Table rows={data.chain} cols={[["EventDate", "Date"], ["TransferType", "Type"], ["PreviousOwnerName", "From"], ["NewOwnerName", "To"], ["SharePct", "Share %"], ["DocumentNo", "Document"], ["DocFileId", "File"], ["VerificationStatus", "Verification"]]} />
            </Section>
            <Section title="RS / LR records" step="RECORD_MAPPING" landId={id}>
              <Table rows={data.records} cols={[["Kind", "Record"], ["Khatian", "Khatian"], ["Dag", "Dag"], ["RecordedHolder", "Holder"], ["Area", "Area"], ["Share", "Share"], ["DocFileId", "File"], ["VerificationStatus", "Verification"]]} />
            </Section>
            <Section title="Documents" step="DOCUMENTS" landId={id}>
              <Table rows={data.documents} cols={[["DocumentCode", "Code"], ["Title", "Title"], ["DocTypeName", "Type"], ["DocumentNo", "Number"], ["CurrentVersionNo", "Version"], ["DocFileId", "File"], ["ReviewStatus", "Review"]]} />
            </Section>
            <Section title="Legal checks" step="CASE_MORTGAGE" landId={id}>
              <Table rows={data.legal} cols={[["Kind", "Item"], ["Detail", "Detail"], ["Status", "Result / status"]]} />
            </Section>
            <Section title="Purchase & sale" step="PURCHASE_SALE" landId={id}>
              <Table rows={data.transactions} cols={[["TransactionNo", "No."], ["TxnType", "Type"], ["BuyerName", "Buyer"], ["SellerNames", "Seller(s)"], ["Area", "Area"], ["TotalValue", "Value ₹"], ["Paid", "Verified paid ₹"], ["TxnStatus", "Status"]]} />
            </Section>
            <Section title="Deed & registration" step="DEED_PREP" landId={id}>
              <Table rows={data.deeds} cols={[["DeedCode", "Deed"], ["DeedTypeName", "Type"], ["ConsiderationAmount", "Consideration ₹"], ["OfficeName", "Office"], ["RegisteredDeedNo", "Registered no."], ["RegistrationDate", "Registered on"], ["RegistrationStatus", "Status"]]} />
            </Section>
            <Section title="Mutation" step="MUTATION_APPLY" landId={id}>
              <Table rows={data.mutations} cols={[["ApplicationNo", "Application"], ["OfficeName", "Office"], ["ApplicationStatus", "Status"], ["OrderNo", "Order"], ["OrderDate", "Order date"]]} />
            </Section>
            <Section title="Pipeline">
              {/* Each step opens on the land's pipeline page. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-1.5 pr-3 font-medium">#</th><th className="pb-1.5 pr-3 font-medium">Step</th><th className="pb-1.5 pr-3 font-medium">Status</th>
                    <th className="pb-1.5 pr-3 font-medium">Updated</th><th className="pb-1.5 font-medium print:hidden" />
                  </tr></thead>
                  <tbody>{data.steps.map((st) => (
                    <tr key={String(st.StepCode)} onClick={() => navigate(`/legal/land/properties/${id}?step=${String(st.StepCode)}`)}
                      className="cursor-pointer border-t border-border/60 hover:bg-muted/40" title="Open this step in the pipeline">
                      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{String(st.StepNo)}</td>
                      <td className="py-1.5 pr-3 text-foreground">{String(st.StepName)}</td>
                      <td className="py-1.5 pr-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.6875rem] ${STEP_STYLE[String(st.Status)] ?? "border-border text-muted-foreground"}`}>{String(st.Status)}</span></td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{st.UpdatedAt ? `${fmtDate(st.UpdatedAt)}${st.UpdatedByName ? ` · ${String(st.UpdatedByName)}` : ""}` : "—"}</td>
                      <td className="py-1.5 text-right text-xs text-muted-foreground print:hidden">Open →</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Section>
          </div>
        )}
      </LegalShell>
    </>
  );
}
