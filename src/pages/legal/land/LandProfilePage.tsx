import React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Global } from "iconsax-react";
import { FileText, GitBranch, Pencil } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { getLandOverview, getLandAudit, type LandOverview } from "@/api/legalLandApi";
import { LegalMasterTable } from "../LegalMasterPage";
import { OwnershipStep } from "./steps/OwnershipStep";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { DocumentsStep } from "./steps/DocumentsStep";

// The central land profile: one page per Land ID, for both entry types. New Acquisition land also has its
// 31-step pipeline (linked from here); Existing / Backlog land is entered and maintained only here.
// Every section is the same shared record table, so add / edit / verify, Active-Inactive and the audit trail
// behave the same everywhere. Nothing here starts a purchase, payment, registration or mutation.

const LAND_PAGE = "legal-land-master";
const table = (key: string, label: string) => ({ pageKey: LAND_PAGE, key, label });

type TabKey = "overview" | "basic" | "ownership" | "transfers" | "records" | "documents" | "legal" | "loans" | "mutation" | "payments" | "tax" | "survey" | "photos" | "activity";
const TABS: { key: TabKey; label: string; count?: keyof LandOverview["counts"] }[] = [
  { key: "overview", label: "Overview" },
  { key: "basic", label: "Basic information" },
  { key: "ownership", label: "Ownership history", count: "ownershipRecords" },
  { key: "transfers", label: "Acquisition & transfers", count: "transfers" },
  { key: "records", label: "Land records (RS / LR)", count: "landRecords" },
  { key: "documents", label: "Documents", count: "documents" },
  { key: "legal", label: "Legal history", count: "legalHistory" },
  { key: "loans", label: "Loan & mortgage", count: "mortgages" },
  { key: "mutation", label: "Mutation history", count: "mutations" },
  { key: "payments", label: "Payment history", count: "payments" },
  { key: "tax", label: "Land tax (Khajna)", count: "taxRecords" },
  { key: "survey", label: "Survey & valuation", count: "valuations" },
  { key: "photos", label: "Photos & notes" },
  { key: "activity", label: "Activity" },
];

// The history of an existing land, in the order it is usually entered (shown as "Next steps" on its Overview).
const NEXT_STEPS: { tab: TabKey; label: string; count: keyof LandOverview["counts"]; hint: string }[] = [
  { tab: "ownership", label: "Ownership history", count: "ownershipRecords", hint: "Earliest known owner, then every change up to the company" },
  { tab: "records", label: "Land records (RS / LR)", count: "landRecords", hint: "RS and LR Khatian / Dag entries" },
  { tab: "documents", label: "Documents", count: "documents", hint: "Deeds, khatian copies, mutation order, receipts — what you have" },
  { tab: "legal", label: "Legal history", count: "legalHistory", hint: "Court cases, orders, notices, title reports" },
  { tab: "loans", label: "Loan & mortgage", count: "mortgages", hint: "Past and current loans on this land" },
  { tab: "mutation", label: "Mutation history", count: "mutations", hint: "Each mutation and its order" },
  { tab: "payments", label: "Payment history", count: "payments", hint: "What was paid for the land, and when" },
  { tab: "tax", label: "Land tax (Khajna)", count: "taxRecords", hint: "Receipts year by year" },
  { tab: "survey", label: "Survey & valuation", count: "valuations", hint: "Surveys and valuations" },
];

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
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
        <thead><tr className="text-left">{["When", "Who", "Action", "Record", "Remarks"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.EventId}>
              <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{new Date(a.CreatedAt).toLocaleString("en-IN")}</td>
              <td className="px-2 py-2">{a.UserName ?? "—"}</td>
              <td className="px-2 py-2">{a.Action}</td>
              <td className="px-2 py-2 text-xs text-muted-foreground">{a.EntityType}{a.EntityId ? ` #${a.EntityId}` : ""}</td>
              <td className="px-2 py-2 text-xs text-muted-foreground">{a.Remarks ?? ""}</td>
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
  const setTab = (t: TabKey) => { params.set("tab", t); setParams(params, { replace: true }); };

  const { data, error, isLoading } = useQuery({ queryKey: ["legal-land-overview", landId], queryFn: () => getLandOverview(landId), enabled: landId > 0 });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["legal-land-overview", landId] });
    queryClient.invalidateQueries({ queryKey: ["legal-land-audit", landId] });
  };

  const land = data?.land;
  const c = data?.counts;
  const isBacklog = land?.EntryType === "Existing / Backlog";
  const btn = "inline-flex items-center gap-1.5 border border-foreground px-3 py-1.5 text-xs font-heading font-semibold uppercase tracking-[0.08em] hover:bg-primary/10";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", land ? land.LandCode : "Land"]} />
      <LegalShell
        title={land ? `${land.LandCode} · ${land.LandName}` : "Land"}
        subtitle={land ? `${land.MouzaName ?? "—"}${land.JLNo ? ` (J.L. ${land.JLNo})` : ""} · ${land.DistrictName ?? "—"} · ${land.Area ?? "—"} ${land.UnitName ?? ""}` : undefined}
        icon={Global}
        action={land && (
          <div className="flex flex-wrap gap-2">
            {!isBacklog && <button className={btn} onClick={() => navigate(`/legal/land/properties/${landId}`)}><GitBranch size={13} /> Acquisition pipeline</button>}
            <button className={btn} onClick={() => navigate(`/legal/land/properties?edit=${landId}`)}><Pencil size={13} /> Edit basic info</button>
            <button className={btn} onClick={() => navigate(`/legal/land/properties/${landId}/details`)}><FileText size={13} /> Full report & PDF</button>
          </div>
        )}
      >
        {error && <p className="text-sm text-destructive">Could not load this land: {(error as Error).message}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {land && c && (
          <div className="space-y-5">
            {/* Tabs — they wrap on narrow screens instead of scrolling off. */}
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`border px-2.5 py-1.5 text-xs font-heading font-semibold ${tab === t.key ? "border-foreground bg-foreground text-card" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
                >
                  {t.label}{t.count !== undefined ? <span className="ml-1 tabular-nums opacity-70">{c[t.count]}</span> : null}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="space-y-4">
                {isBacklog && (
                  <div className={box}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="label">Next steps — enter this land's history</p>
                      <p className="text-xs text-muted-foreground">{NEXT_STEPS.filter((s) => c[s.count] > 0).length} of {NEXT_STEPS.length} sections have records · enter what you have, in any order</p>
                    </div>
                    <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {NEXT_STEPS.map((s, i) => {
                        const done = c[s.count] > 0;
                        return (
                          <li key={s.tab}>
                            <button onClick={() => setTab(s.tab)} className={`flex w-full items-start gap-2.5 border px-3 py-2 text-left hover:bg-primary/5 ${done ? "border-border" : "border-foreground"}`}>
                              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[0.625rem] font-bold ${done ? "bg-foreground text-card" : "border border-foreground text-foreground"}`}>{done ? "✓" : i + 1}</span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-foreground">{s.label}{done ? <span className="ml-1 font-normal text-muted-foreground">· {c[s.count]}</span> : null}</span>
                                <span className="block text-xs text-muted-foreground">{done ? "Added — open to add more or verify" : s.hint}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
                <div className={`${box} grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`}>
                  <Field k="Land ID" v={land.LandCode} />
                  <Field k="Entry type" v={land.EntryType} />
                  <Field k="Land status" v={land.IsOnHold ? `${land.LandStatus} (on hold)` : land.LandStatus} />
                  <Field k="Possession" v={land.PossessionStatus ?? "Not recorded"} />
                  <Field k="Location" v={land.LocationAddress ?? `${land.MouzaName ?? ""}${land.JLNo ? ` J.L. ${land.JLNo}` : ""}`} />
                  <Field k="Total area" v={land.Area !== null ? `${land.Area} ${land.UnitName ?? ""}` : null} />
                  <Field k="Acquired" v={land.AcquisitionDate ? `${fmtDate(land.AcquisitionDate)}${land.AcquisitionDateApprox ? " (approx.)" : ""}` : "Not recorded"} />
                  <Field k="Last updated" v={fmtDate(land.LastUpdated)} />
                </div>
                <div className={box}>
                  <p className={label}>Current recorded owner(s)</p>
                  {data.owners.length ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {data.owners.map((o, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="text-foreground">{o.OwnerName ?? "—"}</span>
                          <span className="text-muted-foreground">{Number(o.SharePct)}% since {fmtDate(o.ValidFrom)}</span>
                          <span className="border border-border px-1.5 text-[0.625rem] uppercase tracking-wider">{o.VerificationStatus}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-1 text-sm text-muted-foreground">No owner recorded yet — add the ownership history.</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {([
                    ["Active court cases", c.activeCases, "legal"], ["Active mortgages", c.activeMortgages, "loans"],
                    ["Documents", c.documents, "documents"], ["Documents not verified", c.documentsUnverified, "documents"],
                    ["Records awaiting verification", c.awaitingVerification, "ownership"], ["Tax receipts", c.taxRecords, "tax"],
                  ] as const).map(([k, v, t]) => (
                    <button key={k} onClick={() => setTab(t)} className={`${box} text-left hover:bg-primary/5`}>
                      <p className="text-2xl font-heading font-bold tabular-nums text-foreground">{v}</p>
                      <p className="mt-1 text-[0.6875rem] leading-tight text-muted-foreground">{k}</p>
                    </button>
                  ))}
                </div>
                <GovtSiteLinks />
                <p className="text-xs text-muted-foreground">
                  Entered on {fmtDate(land.CreatedAt)}{land.CreatedByName ? ` by ${land.CreatedByName}` : ""}. Entered information is not verified until a verifier marks it Verified.
                </p>
              </div>
            )}

            {tab === "basic" && (
              <div className={`${box} grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
                <Field k="Land name" v={land.LandName} />
                <Field k="Entry type" v={land.EntryType} />
                <Field k="District" v={land.DistrictName} />
                <Field k="Mouza" v={land.MouzaName} />
                <Field k="J.L. number" v={land.JLNo} />
                <Field k="RS Dag / Plot" v={land.RsDagNo} />
                <Field k="LR Dag / Plot" v={land.LrDagNo} />
                <Field k="RS Khatian" v={land.RsKhatianNo} />
                <Field k="LR Khatian" v={land.LrKhatianNo} />
                <Field k="Total area" v={land.Area !== null ? `${land.Area} ${land.UnitName ?? ""}` : null} />
                <Field k="Land status" v={land.LandStatus} />
                <Field k="Possession" v={land.PossessionStatus} />
                <Field k="Acquisition date" v={land.AcquisitionDate ? `${fmtDate(land.AcquisitionDate)}${land.AcquisitionDateApprox ? " (approx.)" : ""}` : null} />
                <Field k="Data entry date" v={fmtDate(land.CreatedAt)} />
                <Field k="Address" v={land.LocationAddress} />
                <div className="sm:col-span-2 lg:col-span-3">
                  <button className={btn} onClick={() => navigate(`/legal/land/properties?edit=${landId}`)}><Pencil size={13} /> Edit basic information</button>
                </div>
              </div>
            )}

            {tab === "ownership" && params.get("new") === "1" && (
              <p className="border border-foreground px-3 py-2 text-xs">
                <b>{land.LandCode} saved.</b> Start with the ownership history — the earliest owner you know, then each change up to the company.
                The other sections are under <button className="underline" onClick={() => setTab("overview")}>Overview → Next steps</button>.
              </p>
            )}
            {tab === "ownership" && (
              <Section title="Ownership history" note="Every owner from the earliest known one to today. A change never overwrites an old owner — it closes their period and adds the new owner(s).">
                <OwnershipStep landId={landId} onSaved={refresh} />
              </Section>
            )}

            {tab === "transfers" && (
              <Section title="Acquisition & transfer history" note="How the land passed from owner to owner — sale, inheritance, gift, partition — with the deed and registration details. Add a transfer from Ownership history (Record ownership change); edit or verify it here.">
                <LegalMasterTable entry={table("ownership-event", "Ownership Transfer")} parentId={landId} noAdd onSaved={refresh} />
              </Section>
            )}

            {tab === "records" && (
              <div className="space-y-6">
                <Section title="RS records"><LegalMasterTable entry={table("land-rs-record", "RS Record")} parentId={landId} onSaved={refresh} /></Section>
                <Section title="LR Records of Rights"><LegalMasterTable entry={table("land-lr-record", "LR Record of Rights")} parentId={landId} onSaved={refresh} /></Section>
              </div>
            )}

            {tab === "documents" && (
              <Section title="Document archive" note={isBacklog ? "Add the documents you have — none is mandatory for existing land. Each upload keeps its versions." : undefined}>
                <DocumentsStep landId={landId} onSaved={refresh} />
              </Section>
            )}

            {tab === "legal" && (
              <div className="space-y-6">
                <Section title="Court cases"><LegalMasterTable entry={table("legal-case", "Court Case")} parentId={landId} onSaved={refresh} /></Section>
                <Section title="Other legal records" note="Orders, judgments, notices, affidavits, power of attorney, NOCs, title and due-diligence reports. Records only — nothing is filed or sent.">
                  <LegalMasterTable entry={table("land-legal-record", "Legal Record")} parentId={landId} onSaved={refresh} />
                </Section>
              </div>
            )}

            {tab === "loans" && (
              <Section title="Loan & mortgage history" note="Closed loans stay on record — set the loan status to Closed and the release date instead of deleting.">
                <LegalMasterTable entry={table("mortgage", "Mortgage & Loan")} parentId={landId} onSaved={refresh} />
              </Section>
            )}

            {tab === "mutation" && (
              <div className="space-y-6">
                <Section title="Mutation history"><LegalMasterTable entry={table("mutation", "Mutation")} parentId={landId} onSaved={refresh} /></Section>
                <Section title="New Khatian / RoR after mutation"><LegalMasterTable entry={table("mutation-record", "New Khatian / RoR")} parentId={landId} onSaved={refresh} /></Section>
              </div>
            )}

            {tab === "payments" && (
              <Section title="Payment history" note="Past payments for this land. Recording one here does not start any payment.">
                <LegalMasterTable entry={table("payment", "Payment")} parentId={landId} onSaved={refresh} />
              </Section>
            )}

            {tab === "tax" && (
              <Section title="Land tax (Khajna)"><LegalMasterTable entry={table("land-tax", "Land Tax (Khajna)")} parentId={landId} onSaved={refresh} /></Section>
            )}

            {tab === "survey" && (
              <Section title="Survey & valuation"><LegalMasterTable entry={table("valuation", "Valuation & Survey")} parentId={landId} onSaved={refresh} /></Section>
            )}

            {tab === "photos" && (
              <Section title="Photos & notes"><LegalMasterTable entry={table("land-photo", "Land Photo")} parentId={landId} onSaved={refresh} /></Section>
            )}

            {tab === "activity" && (
              <Section title="Activity" note="Who added, changed or removed what on this land, with the old and new values kept in the audit trail.">
                <Activity landId={landId} />
              </Section>
            )}
          </div>
        )}
      </LegalShell>
    </>
  );
}
