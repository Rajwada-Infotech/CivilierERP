import React, { useState } from "react";
import { openLegalMap } from "@/components/legal/LegalDocumentPreview";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Global } from "iconsax-react";
import { FileText, Pencil, ShieldCheck, CheckCircle2, RotateCcw, XCircle, Clock, AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import {
  getLandOverview,
  getLandAudit,
  verifyLand,
  submitLandForL1,
  actionLandL1,
  actionLandL2,
  type LandOverview,
} from "@/api/legalLandApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LegalMasterTable } from "../LegalMasterPage";
import { OwnershipStep } from "./steps/OwnershipStep";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
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
  { key: "documents", label: "Documents", count: "documents" },
  { key: "legal", label: "Legal Information", count: "legalHistory" },
  { key: "loans", label: "Loan & Mortgage", count: "mortgages" },
  { key: "mutation", label: "Mutation Records", count: "mutations" },
  { key: "payments", label: "Payment History", count: "payments" },
  { key: "tax", label: "Land Tax (Khajna)", count: "taxRecords" },
  { key: "survey", label: "Survey & Valuation", count: "valuations" },
  { key: "photos", label: "Notes & Attachments" },
  { key: "activity", label: "Activity History" },
];

const QUICK_SECTIONS: { tab: TabKey; label: string; count: keyof LandOverview["counts"]; hint: string }[] = [
  { tab: "ownership", label: "Ownership History", count: "ownershipRecords", hint: "Earliest known owner, then every change up to the company" },
  { tab: "transfers", label: "Acquisition & Purchase", count: "transfers", hint: "Sale deed numbers, dates, purchase price & consideration" },
  { tab: "records", label: "Land Records (RS / LR)", count: "landRecords", hint: "RS and LR Khatian / Dag entries and mappings" },
  { tab: "documents", label: "Documents Archive", count: "documents", hint: "Deeds, khatian copies, mutation orders, tax receipts" },
  { tab: "legal", label: "Legal Information", count: "legalHistory", hint: "Court cases, dispute records, orders, notices, legal opinions" },
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
              <td className="px-2 py-2">{a.UserName ?? "—"}</td>
              <td className="px-2 py-2">{a.Action}</td>
              <td className="px-2 py-2 text-xs text-muted-foreground">
                {a.EntityType}
                {a.EntityId ? ` #${a.EntityId}` : ""}
              </td>
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
  const [actionModal, setActionModal] = useState<{
    type: "verify" | "submit-l1" | "action-l1" | "action-l2";
    action?: "Approve" | "Return" | "Reject";
    title: string;
    hint: string;
  } | null>(null);
  const [remarks, setRemarks] = useState("");

  const verifyMutation = useMutation({
    mutationFn: (r?: string) => verifyLand(landId, r),
    onSuccess: (res) => {
      toast.success(res.message);
      refresh();
      setActionModal(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitL1Mutation = useMutation({
    mutationFn: () => submitLandForL1(landId),
    onSuccess: (res) => {
      toast.success(res.message);
      refresh();
      setActionModal(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const actionL1Mutation = useMutation({
    mutationFn: (p: { action: "Approve" | "Return"; remarks: string }) =>
      actionLandL1(landId, p.action, p.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      refresh();
      setActionModal(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const actionL2Mutation = useMutation({
    mutationFn: (p: { action: "Approve" | "Return" | "Reject"; remarks: string }) =>
      actionLandL2(landId, p.action, p.remarks),
    onSuccess: (res) => {
      toast.success(res.message);
      refresh();
      setActionModal(null);
      setRemarks("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal) return;
    if (actionModal.type === "verify") {
      verifyMutation.mutate(remarks);
    } else if (actionModal.type === "submit-l1") {
      submitL1Mutation.mutate();
    } else if (actionModal.type === "action-l1") {
      actionL1Mutation.mutate({ action: actionModal.action as "Approve" | "Return", remarks });
    } else if (actionModal.type === "action-l2") {
      actionL2Mutation.mutate({ action: actionModal.action as "Approve" | "Return" | "Reject", remarks });
    }
  };

  const isPending =
    verifyMutation.isPending ||
    submitL1Mutation.isPending ||
    actionL1Mutation.isPending ||
    actionL2Mutation.isPending;

  const land = data?.land;
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
            {/* ── LAND-WISE VERIFICATION & TWO-LEVEL APPROVAL RAIL ── */}
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                <div>
                  <h4 className="text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground">
                    Land Verification & Two-Level Approval Rail
                  </h4>
                  <p className="mt-0.5 text-xs text-foreground">
                    Workflow Status:{" "}
                    <b className="font-semibold text-primary">{land.WorkflowStatus ?? "Draft"}</b>
                  </p>
                </div>

                {/* Quick Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {land.VerificationStatus !== "Verified" && (
                    <button
                      onClick={() => {
                        setActionModal({
                          type: "verify",
                          title: "Verify Land Data",
                          hint: "Confirm that initial land entry and documentation have been reviewed and verified.",
                        });
                        setRemarks("");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm"
                    >
                      <CheckCircle2 size={13} /> Verify Land Data
                    </button>
                  )}

                  {land.VerificationStatus === "Verified" &&
                    land.L1Status !== "Approved" &&
                    land.L1Status !== "Pending" && (
                      <button
                        onClick={() => {
                          setActionModal({
                            type: "submit-l1",
                            title: "Submit for L1 Review",
                            hint: "Forward this verified property to the Legal Officer for L1 review.",
                          });
                          setRemarks("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                      >
                        <Send size={13} /> Submit for L1 Review
                      </button>
                    )}

                  {land.L1Status === "Pending" && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setActionModal({
                            type: "action-l1",
                            action: "Return",
                            title: "Return from L1 Review",
                            hint: "Return this land to Draft status for necessary corrections.",
                          });
                          setRemarks("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                      >
                        <RotateCcw size={13} /> Return to Draft
                      </button>
                      <button
                        onClick={() => {
                          setActionModal({
                            type: "action-l1",
                            action: "Approve",
                            title: "L1 Approve Land Record",
                            hint: "Formally approve Level 1 review and forward to Level 2 Executive Approval.",
                          });
                          setRemarks("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                      >
                        <CheckCircle2 size={13} /> L1 Approve & Forward
                      </button>
                    </div>
                  )}

                  {land.L1Status === "Approved" && land.L2Status === "Pending" && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setActionModal({
                            type: "action-l2",
                            action: "Return",
                            title: "Return from L2 Approval",
                            hint: "Return this land back to L1 Legal Review.",
                          });
                          setRemarks("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                      >
                        <RotateCcw size={13} /> Return to L1
                      </button>
                      <button
                        onClick={() => {
                          setActionModal({
                            type: "action-l2",
                            action: "Reject",
                            title: "Reject Land Record",
                            hint: "Reject this property acquisition / entry.",
                          });
                          setRemarks("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
                      >
                        <XCircle size={13} /> Reject
                      </button>
                      <button
                        onClick={() => {
                          setActionModal({
                            type: "action-l2",
                            action: "Approve",
                            title: "L2 Final Approval",
                            hint: "Grant executive / partner final sign-off. Property status becomes Active / Owned.",
                          });
                          setRemarks("");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm"
                      >
                        <ShieldCheck size={13} /> L2 Final Sign-Off
                      </button>
                    </div>
                  )}

                  {land.L2Status === "Approved" && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 size={14} /> Fully Approved & Active Land Record
                    </span>
                  )}
                </div>
              </div>

              {/* 4 Steps Stepper */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3">
                {/* Step 1: Data Entry */}
                <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">Step 1</span>
                    <CheckCircle2 size={14} className="text-emerald-600" />
                  </div>
                  <p className="mt-1 font-semibold text-xs text-foreground">Data Entry</p>
                  <p className="text-[0.6875rem] text-muted-foreground">Initial property record created</p>
                </div>

                {/* Step 2: Verification */}
                <div className={`rounded-lg border p-2.5 ${
                  land.VerificationStatus === "Verified"
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-amber-500/30 bg-amber-500/10"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">Step 2</span>
                    {land.VerificationStatus === "Verified" ? (
                      <CheckCircle2 size={14} className="text-emerald-600" />
                    ) : (
                      <Clock size={14} className="text-amber-600" />
                    )}
                  </div>
                  <p className="mt-1 font-semibold text-xs text-foreground">Data Verification</p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {land.VerificationStatus === "Verified" ? "Verified" : "Draft / Needs Verification"}
                  </p>
                </div>

                {/* Step 3: L1 Legal Review */}
                <div className={`rounded-lg border p-2.5 ${
                  land.L1Status === "Approved"
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : land.L1Status === "Returned"
                    ? "border-amber-500/30 bg-amber-500/10"
                    : "border-blue-500/30 bg-blue-500/10"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">Step 3</span>
                    {land.L1Status === "Approved" ? (
                      <CheckCircle2 size={14} className="text-emerald-600" />
                    ) : land.L1Status === "Returned" ? (
                      <RotateCcw size={14} className="text-amber-600" />
                    ) : (
                      <Clock size={14} className="text-blue-600" />
                    )}
                  </div>
                  <p className="mt-1 font-semibold text-xs text-foreground">L1 Legal Review</p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {land.L1Status === "Approved"
                      ? `Approved by ${land.L1ReviewerName || "Legal Officer"}`
                      : land.L1Status === "Returned"
                      ? "Returned for edits"
                      : "Pending Legal Review"}
                  </p>
                </div>

                {/* Step 4: L2 Executive Approval */}
                <div className={`rounded-lg border p-2.5 ${
                  land.L2Status === "Approved"
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : land.L2Status === "Returned"
                    ? "border-amber-500/30 bg-amber-500/10"
                    : land.L2Status === "Rejected"
                    ? "border-destructive/30 bg-destructive/10"
                    : "border-purple-500/30 bg-purple-500/10"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">Step 4</span>
                    {land.L2Status === "Approved" ? (
                      <ShieldCheck size={14} className="text-emerald-600" />
                    ) : land.L2Status === "Rejected" ? (
                      <XCircle size={14} className="text-destructive" />
                    ) : (
                      <Clock size={14} className="text-purple-600" />
                    )}
                  </div>
                  <p className="mt-1 font-semibold text-xs text-foreground">L2 Executive Approval</p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {land.L2Status === "Approved"
                      ? `Signed off by ${land.L2ApproverName || "Executive"}`
                      : land.L2Status === "Rejected"
                      ? "Rejected"
                      : land.L2Status === "Returned"
                      ? "Returned to L1"
                      : "Pending Executive Sign-off"}
                  </p>
                </div>
              </div>
            </div>

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
            <Dialog open={!!actionModal} onOpenChange={() => setActionModal(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{actionModal?.title}</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    {actionModal?.hint}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleModalSubmit} className="space-y-4 py-2">
                  <div>
                    <Label htmlFor="remarks">
                      Comments / Remarks {actionModal?.action === "Return" || actionModal?.action === "Reject" ? "*" : "(Optional)"}
                    </Label>
                    <Textarea
                      id="remarks"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Add instructions or justification for this decision..."
                      required={actionModal?.action === "Return" || actionModal?.action === "Reject"}
                      rows={3}
                      className="mt-1"
                    />
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button type="button" variant="outline" onClick={() => setActionModal(null)} disabled={isPending}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Processing..." : "Confirm"}
                    </Button>
                  </DialogFooter>
                </form>
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
                          <span className="border border-border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                            {o.VerificationStatus}
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
          </div>
        )}
      </LegalShell>
    </>
  );
}
