import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DocumentText } from "iconsax-react";
import { ArrowLeft, Download } from "lucide-react";
import { printLegalSheet } from "@/lib/legalPrint";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell, LEGAL_ACCENT } from "@/components/legal/LegalShell";
import { getLandDossier, getFinalStatus, finalVerifyLand, reverifyDeedChanges } from "@/api/legalLandApi";
import { LegalFileLink, openLegalMap } from "@/components/legal/LegalDocumentPreview";

// Everything recorded on one land property, section by section, on one page. "Download PDF" prints just this
// sheet (the browser's Save as PDF), so the PDF always matches what is on screen.

type Row = Record<string, unknown>;
const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const cell = (v: unknown): React.ReactNode =>
  v === null || v === undefined || v === "" ? "—"
    : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDate(v)
    : typeof v === "number" ? v.toLocaleString("en-IN") : String(v);

/** A section; `to` opens the Land Profile tab where it is edited. */
const Section: React.FC<{ title: string; to?: string; toLabel?: string; children: React.ReactNode }> = ({ title, to, toLabel = "Open", children }) => {
  const navigate = useNavigate();
  return (
    <section className="break-inside-avoid border-t border-border pt-4 print:pt-3">
      <div className="mb-2 flex items-center flex-wrap justify-between gap-2">
        <h3 className="text-xs font-heading font-semibold uppercase tracking-[0.16em]" style={{ color: LEGAL_ACCENT }}>{title}</h3>
        {to ? (
          <button className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline print:hidden" onClick={() => navigate(to)}>
            {toLabel} →
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

/**
 * Final verification (end of the full-details page): the verifier has read every detail and document above,
 * sets the timeline (deed to be done by) and sends the land to the deed department.
 */
function FinalVerifyPanel({ landId }: { landId: number }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: st } = useQuery({ queryKey: ["legal-land-final", landId], queryFn: () => getFinalStatus(landId) });
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  if (st.inDeedProcess && st.changed) return <ReverifyPanel landId={landId} st={st} />;
  if (st.inDeedProcess) return (
    <section className="flex flex-wrap items-center justify-between gap-3 border-2 border-emerald-600 bg-emerald-500/5 p-4 print:hidden">
      <div>
        <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-emerald-700">Verified · {st.workflowStatus}</p>
        <p className="mt-1 text-sm text-foreground">
          Verified{st.verifiedBy ? ` by ${st.verifiedBy}` : ""}{st.verifiedAt ? ` on ${fmtDate(st.verifiedAt)}` : ""}{st.targetDate ? ` · deed timeline ${fmtDate(st.targetDate)}` : ""}. No changes since verification.
        </p>
      </div>
      <button onClick={() => navigate("/legal/land/deed-process")} className="border border-foreground px-3 py-1.5 text-xs font-heading font-semibold uppercase tracking-[0.08em] hover:bg-primary/10">Open Deed Process</button>
    </section>
  );

  const submit = async () => {
    setBusy(true);
    try {
      toast.success((await finalVerifyLand(landId, target)).message);
      qc.invalidateQueries({ queryKey: ["legal-land-final", landId] });
      qc.invalidateQueries({ queryKey: ["legal-land-overview", landId] });
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
      navigate("/legal/land/deed-process");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not verify");
    } finally { setBusy(false); }
  };

  return (
    <section className="border-2 border-foreground p-4 print:hidden">
      <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Final verification</p>
      {!st.ready ? <p className="mt-1 text-sm text-destructive">Data entry is not complete: {st.missing.join(", ")}.</p>
        : !st.canVerify ? <p className="mt-1 text-sm text-muted-foreground">{st.blockedReason}</p>
        : (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">Timeline — deed to be done by *
              <input type="date" min={new Date().toISOString().slice(0, 10)} value={target} onChange={(e) => setTarget(e.target.value)}
                className="mt-1 block border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <button disabled={!target || busy} onClick={submit}
              className="bg-foreground px-4 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? "Saving…" : "Deed Process"}
            </button>
          </div>
        )}
    </section>
  );
}

/** Land in Deed Process changed after verification: the verifier checks the changes and ticks Verified. */
function ReverifyPanel({ landId, st }: { landId: number; st: NonNullable<Awaited<ReturnType<typeof getFinalStatus>>> }) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const ch = st.changed!;
  const submit = async () => {
    setBusy(true);
    try {
      toast.success((await reverifyDeedChanges(landId)).message);
      qc.invalidateQueries({ queryKey: ["legal-land-final", landId] });
      qc.invalidateQueries({ queryKey: ["legal-deed-process"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not verify"); } finally { setBusy(false); }
  };
  return (
    <section className="border-2 border-amber-500 bg-amber-500/5 p-4 print:hidden">
      <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-amber-700">Changed after verification</p>
      <p className="mt-1 text-sm">This land was changed after it went to Deed Process{ch.by ? ` (last by ${ch.by})` : ""}. Check the changes above, then verify.</p>
      {ch.items.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-auto text-xs text-muted-foreground">
          {ch.items.map((x, i) => <li key={i}>{fmtDate(x.CreatedAt)} · {x.UserName ?? "—"} · {x.Action} — {x.EntityType}</li>)}
        </ul>
      )}
      {st.canVerify || st.blockedReason?.includes("entered") ? null : <p className="mt-2 text-sm text-muted-foreground">{st.blockedReason}</p>}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Verified — I have checked these changes
      </label>
      <button disabled={!checked || busy} onClick={submit} className="mt-3 bg-foreground px-4 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "Saving…" : "Save verification"}
      </button>
    </section>
  );
}

// Where the page was opened from: its breadcrumb, back button and sidebar item stay in that section.
const FROM = {
  "deed-process": { label: "Deed Process", path: "/legal/land/deed-process" },
  "deed-registration": { label: "Deed Registration", path: "/legal/deed-registration" },
} as const;

export default function LandDetailsPage({ verify = false, from }: { verify?: boolean; from?: keyof typeof FROM }) {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-land-dossier", id], queryFn: () => getLandDossier(id), enabled: id > 0 });
  const print = () => printLegalSheet();
  const L = data?.land ?? {};
  const kv = (k: string, v: unknown) => <div><dt className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="text-sm text-foreground">{cell(v)}</dd></div>;
  const current = (data?.owners ?? []).filter((o) => !o.ValidTo);
  // Every land (new or existing) is kept on its Land Profile: each section opens the matching tab.
  const backlog = L.EntryType === "Existing / Backlog";
  const home = `/legal/land/properties/${id}`;
  const at = (tab: string) => ({ to: `${home}?tab=${tab}`, toLabel: "Open in Land Profile" });
  const lat = L.GpsLatitude, lng = L.GpsLongitude;

  return (
    <>
      <Breadcrumbs items={from
        ? [{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: FROM[from].label, path: FROM[from].path }, { label: String(L.LandCode ?? "…") }]
        : [{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Land Register", path: "/legal/land/properties" }, { label: String(L.LandCode ?? "…"), path: home }, { label: verify ? "Final verification" : "Full details" }]} />
      <LegalShell
        title={`${String(L.LandCode ?? "")} · ${String(L.LandName ?? "")}`}
        subtitle={verify ? "Check every detail and document, set the timeline and send to Deed Process" : "Everything recorded on this land"}
        icon={DocumentText}
        action={
          <div className="flex gap-2 print:hidden">
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => navigate(from ? FROM[from].path : home)}><ArrowLeft size={13} /><span className="hidden sm:inline">{from ? FROM[from].label : "Land Profile"}</span></button>
            <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-card" style={{ background: LEGAL_ACCENT }} disabled={!data} onClick={print}><Download size={13} /> Download PDF</button>
          </div>
        }
      >
        {error ? <p className="p-6 text-destructive">{(error as Error).message}</p> : isLoading || !data ? <p className="p-6 text-muted-foreground">Loading…</p> : (
          <div className="legal-print space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-6 print:border-0 print:p-0">
            <div className="hidden flex-wrap items-baseline justify-between gap-2 print:flex">
              <h2 className="text-xl font-heading font-bold text-foreground">{String(L.LandCode)} — {String(L.LandName)}</h2>
              <span className="text-xs text-muted-foreground">Printed {fmtDate(new Date().toISOString())} · CivilierERP Legal</span>
            </div>

            <Section title="Property" {...at("basic")}>
              <dl className="grid gap-3 sm:grid-cols-3">
                {kv("Mouza (J.L.)", L.MouzaName ? `${L.MouzaName} (${L.JLNo ?? "-"})` : null)}
                {kv("District", L.DistrictName)}
                {kv("Sub-division / Block", [L.SubDivisionName, L.BlockName].filter(Boolean).join(" / "))}
                {kv("Village / Police station", [L.VillageName, L.StationName].filter(Boolean).join(" / "))}
                {kv("Municipality", L.Municipality)}
                {kv("Area", L.Area != null ? `${Number(L.Area)} ${L.UnitName ?? ""}` : null)}
                {kv("Land type", L.LandTypeName)}
                {kv("Land status", L.LandStatus)}
                {kv("Entry type", L.EntryType)}
                {backlog ? kv("Possession", L.PossessionStatus) : kv("Workflow", L.IsCancelled ? "Cancelled" : L.IsOnHold ? "On hold" : L.WorkflowStatus)}
                {kv("Acquired on", L.AcquisitionDate ? `${fmtDate(L.AcquisitionDate)}${L.AcquisitionDateApprox ? " (approx.)" : ""}` : null)}
                {kv("RS Dag / Khatian", [L.RsDagNo, L.RsKhatianNo].filter(Boolean).join(" / "))}
                {kv("LR Dag / Khatian", [L.LrDagNo, L.LrKhatianNo].filter(Boolean).join(" / "))}
                {kv("Address", L.LocationAddress)}
                {kv("Boundaries N / S", [L.NorthBoundary, L.SouthBoundary].filter(Boolean).join(" / "))}
                {kv("Boundaries E / W", [L.EastBoundary, L.WestBoundary].filter(Boolean).join(" / "))}
                <div><dt className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">GPS</dt><dd className="text-sm text-foreground">
                  {lat != null && lng != null ? <>{String(lat)}, {String(lng)} <button className="ml-1 text-xs underline print:hidden" onClick={() => openLegalMap(lat, lng, `${String(L.LandCode)} · map`)}>Map</button></> : "—"}
                </dd></div>
                {!backlog && kv("From enquiry", L.EnquiryNo)}
              </dl>
            </Section>

            <Section title="Current owners" {...at("ownership")}>
              <Table rows={current} cols={[["OwnerName", "Owner"], ["OwnerGuardian", "Father / husband"], ["SharePct", "Share %"], ["ValidFrom", "Since"]]} />
            </Section>
            <Section title="Ownership chain" {...at("ownership")}>
              <Table rows={data.chain} cols={[["EventDate", "Transfer date"], ["TransferType", "Transfer type"], ["PreviousOwnerName", "From (previous owner)"], ["NewOwnerName", "To (new owner)"], ["SharePct", "Share %"], ["DocumentNo", "Deed / document no."], ["DocFileId", "Deed copy"]]} />
            </Section>
            <Section title="RS / LR records" {...at("records")}>
              <Table rows={data.records} cols={[["Kind", "Record (RS / LR)"], ["Khatian", "Khatian no."], ["Dag", "Dag no."], ["RecordedHolder", "Recorded holder"], ["Area", "Area"], ["Share", "Share"], ["DocFileId", "Record copy"]]} />
            </Section>
            <Section title="Documents" {...at("documents")}>
              <Table rows={data.documents} cols={[["DocumentCode", "Document ID"], ["Title", "Title"], ["DocTypeName", "Document type"], ["DocumentNo", "Document no."], ["CurrentVersionNo", "Version"], ["DocFileId", "Copy"]]} />
            </Section>
            <Section title="Legal checks" {...at("legal")}>
              <Table rows={data.legal} cols={[["Kind", "Legal item"], ["Detail", "Case / lender / reference"], ["Status", "Result / status"]]} />
            </Section>
            <Section title="Legal records" {...at("legal")}>
              <Table rows={data.legalRecords ?? []} cols={[["RecordType", "Record type"], ["CaseNumber", "Case / ref no."], ["CourtAuthority", "Court / authority"], ["FilingDate", "Filed"], ["OrderDate", "Order"], ["RecordStatus", "Status"], ["DocFileId", "Order / notice copy"]]} />
            </Section>
            <Section title="Loans & mortgages" {...at("loans")}>
              <Table rows={data.loans ?? []} cols={[["LenderName", "Lender"], ["LoanType", "Loan type"], ["LoanAmount", "Amount ₹"], ["OutstandingAmount", "Outstanding ₹"], ["LoanStartDate", "Start"], ["LoanClosureDate", "Closed"], ["LoanStatus", "Status"]]} />
            </Section>
            <Section title="Payments" {...at("payments")}>
              <Table rows={data.payments ?? []} cols={[["PaymentDate", "Payment date"], ["TxnType", "Payment purpose"], ["Amount", "Amount ₹"], ["Payer", "Paid by"], ["Payee", "Paid to"], ["PaymentMode", "Mode"], ["Ref", "Reference"], ["DocFileId", "Receipt"]]} />
            </Section>
            <Section title="Land tax (Khajna)" {...at("tax")}>
              <Table rows={data.taxes ?? []} cols={[["TaxYear", "Year"], ["PaymentDate", "Paid on"], ["Amount", "Amount ₹"], ["ReceiptNo", "Receipt no."], ["RelatedOwner", "Owner"], ["DocFileId", "Receipt"]]} />
            </Section>
            <Section title="Survey & valuation" {...at("survey")}>
              <Table rows={data.valuations ?? []} cols={[["ValuationDate", "Valuation date"], ["EstimatedMarketValue", "Market value ₹"], ["GovernmentValuation", "Govt. value ₹"], ["ValuationSource", "Source"], ["Surveyor", "Surveyor"], ["SurveyDate", "Survey date"], ["DocFileId", "Valuation report"]]} />
            </Section>
            {(!backlog || data.transactions.length > 0) && <Section title="Purchase & sale" {...at("transfers")}>
              <Table rows={data.transactions} cols={[["TransactionNo", "Transaction no."], ["TxnType", "Purchase / sale"], ["BuyerName", "Buyer"], ["SellerNames", "Seller(s)"], ["Area", "Area"], ["TotalValue", "Value ₹"], ["Paid", "Verified paid ₹"], ["TxnStatus", "Status"]]} />
            </Section>}
            {data.deeds.length > 0 && <Section title="Deed & registration" {...at("transfers")}>
              <Table rows={data.deeds} cols={[["DeedCode", "Deed ID"], ["DeedTypeName", "Deed type"], ["ConsiderationAmount", "Consideration ₹"], ["OfficeName", "Office"], ["RegisteredDeedNo", "Registered no."], ["RegistrationDate", "Registered on"], ["RegistrationStatus", "Status"]]} />
            </Section>}
            <Section title="Mutation" {...at("mutation")}>
              <Table rows={data.mutations} cols={[["ApplicationNo", "Mutation application no."], ["OfficeName", "BL&LRO office"], ["ApplicationStatus", "Application status"], ["OrderNo", "Mutation order no."], ["OrderDate", "Order date"]]} />
            </Section>
            <FinalVerifyPanel landId={id} />
          </div>
        )}
      </LegalShell>
    </>
  );
}
