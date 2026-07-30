import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus, Search, ChevronRight, CheckCircle2, Clock, XCircle, Building2, IdCard,
  ExternalLink, ChevronLeft, Upload, Trash2, FileText, ParkingSquare, User, Phone, FileBadge,
  Mail, MapPin, IndianRupee, Users2, Briefcase, History, X, PlayCircle, Ban, Lock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/applications";
const CUSTOMER_API = "/api/crm/customers";
const COMPANY_API = "/api/business/dropdown";
const SA_LEADS_API = "/api/sa/leads";
const UNIT_API = "/api/unit-master";
const BANK_DETAIL_API = "/api/crm/customer-bank-details";
const DOC_API = "/api/crm/booking-documents";
const PARKING_API = "/api/crm/parking";
const CO_APPLICANT_API = "/api/crm/co-applicants";
const PROJECT_BANK_API = "/api/crm/project-banks";
const BANK_MASTER_API = "/api/bank-master";
const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];

const STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Cancelled", "Expired"];
// Mirrors SaLead.SourceType so lead source values stay consistent across the whole system
const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];
const DOC_TYPES = ["IdentityProof", "AddressProof", "PhotoID", "IncomeProof", "Other"];

const statusColor: Record<string, string> = {
  Draft:     "text-muted-foreground bg-muted/50 border-border",
  Pending:   "text-blue-600 bg-blue-50 border-blue-200",
  Approved:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-orange-600 bg-orange-50 border-orange-200",
  Expired:   "text-slate-500 bg-slate-100 border-slate-200",
};

const EMPTY_FORM = {
  CustomerId: "", CompanyId: "",
  ProjectId: "", BlockId: "", FloorNo: "", PreferredUnitId: "", PaymentPlanId: "",
  RatePerSqFt: "", DateOfApply: new Date().toISOString().slice(0, 10),
  Source: "", PlatformId: "", CampaignId: "", AdId: "", ChannelPartnerId: "",
  // ViaBroker is UI-only (never sent to the backend) — it just toggles the
  // broker sub-block; BrokerId being set is what actually matters server-side.
  ViaBroker: false, BrokerId: "", BrokerageRatePercent: "", BrokerageSplitEnabled: false,
  Notes: "",
  // Payment Details (Step 6/Details) — these columns already existed on
  // CrmApplication and were already read by handleCreateBooking's retry
  // payload, but nothing in the wizard ever captured them until now.
  TokenType: "Percentage", TokenValue: "", PaymentMode: "", DepositBankId: "",
};

const EMPTY_BANK = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  NomineeName: "", NomineeRelation: "", NomineeDob: "", NomineeContact: "", NomineeAddress: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "",
};

// Which real company bank account the token payment lands in — scoped to
// the selected Project (falls back to the open bank list if the project has
// none tagged), same "Deposited To" pattern CrmBooking.tsx, CrmBookingDetail.tsx
// and CrmPaymentMilestones.tsx all already use for this exact decision.
async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (!projectId) return [];
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAllBanks(): Promise<any[]> {
  try { const r = await fetchWithAuth(BANK_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}

// The management page needs every stage (Converted/In Process/Not
// Converted) for its own tabs — every other page's application-selector
// dropdown deliberately gets the narrower default (Converted excluded, see
// crmApplications.js GET /), so only this page opts back in.
async function fetchApps(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(`${API}?includeConverted=1`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchAppDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}

const STAGES = ["InProcess", "Converted", "NotConverted"] as const;
type Stage = typeof STAGES[number];
const stageLabel: Record<Stage, string> = { InProcess: "In Process", Converted: "Converted", NotConverted: "Not Converted" };
const stageIcon: Record<Stage, any> = { InProcess: Clock, Converted: CheckCircle2, NotConverted: XCircle };
async function fetchCustomers(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(CUSTOMER_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
// Used only to auto-fetch a selected customer's original lead interest/
// source-chain data (property type, source chain) onto this application —
// Lead selection itself now happens once, on the Customer record.
async function fetchLeadOptions(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(SA_LEADS_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchCompanies(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(COMPANY_API);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.companies || []).map((c: any) => ({ Id: c.id, Name: c.name }));
  } catch { return []; }
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}/projects`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchUnits(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchPlatforms(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/sa/social-media"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchCampaigns(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/sa/campaigns/dropdown"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAds(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/sa/ads/dropdown"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchChannelPartners(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/sa/channel-partners"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBrokers(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/account-head?type=BR"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchPaymentPlans(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/crm/payment-plans"); return r.ok ? r.json() : []; } catch { return []; }
}
// Blocks' own tagged PaymentPlanIds — the middle tier of the Project ->
// Block -> Unit cascade (see crmEntityCreation.js's getApplicablePaymentPlans).
async function fetchBlockPlanTags(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/block-master"); return r.ok ? r.json() : []; } catch { return []; }
}

// Same shape CrmPaymentPlans.tsx already parses off the list endpoint's
// MilestonesJson column — reused here so the brief plan-preview card below
// can compute real ₹ figures instead of just repeating raw %s.
type MilestoneRow = { name: string; pct: number };
function parseMilestones(json: string | null | undefined): MilestoneRow[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    return (raw as any[]).map((r) => ({ name: r.name, pct: Number(r.pct) || 0 }));
  } catch { return []; }
}

const inputCls = "w-full text-sm border border-border rounded px-2 py-1.5 bg-background";
const labelCls = "text-xs text-muted-foreground block mb-1";

const CrmApplication: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [activeStage, setActiveStage] = useState<Stage>("InProcess");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(1);
  // Furthest step this application has actually reached — persisted
  // server-side as CrmApplication.CurrentStep so Resume can land back where
  // the user left off, and so the stepper tabs can be clicked to jump to
  // anything already visited.
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [loadingApplication, setLoadingApplication] = useState(false);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [applicationNo, setApplicationNo] = useState<string | null>(null);
  // Status of the application currently open in the wizard, as loaded from
  // the server (null while creating a brand-new one in step 1). Drives
  // whether the Project/Unit tree can be unlocked for editing at all — see
  // canEditUnitSelection below. Kept separate from `form` since it's never
  // itself an editable field.
  const [wizardAppStatus, setWizardAppStatus] = useState<string | null>(null);
  // Company/Project/Block/Floor/Unit/Payment Plan start locked (read-only)
  // once an already-saved application is resumed, same as sourceLocked
  // below — "Edit" unlocks them for the (normal, expected) case of
  // adjusting the pick before approval. Once Approved, canEditUnitSelection
  // goes false and no Edit control is ever shown, so this can't be
  // unlocked at all past that point (see the Project/Unit tree JSX).
  const [unitLocked, setUnitLocked] = useState(false);
  // Locked once a source chain is auto-fetched from the customer's linked
  // lead — "Change" lets staff override it for the (rarer) case the
  // customer's actual source for THIS application differs from their
  // original lead's source. Unlocked by default for customers with no
  // linked lead, since there is nothing to auto-fetch.
  const [sourceLocked, setSourceLocked] = useState(false);
  // (No more planLocked/auto-fetch state — Unit Master no longer has a
  // single "default" plan to silently apply; Payment Plan is always an
  // explicit, mandatory pick once a unit is on the application.)
  const [invoiceRow, setInvoiceRow] = useState<any | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ Amount: "", InvoiceType: "Booking", InvoiceDate: "", Description: "" });
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [viewingAppId, setViewingAppId] = useState<number | null>(null);
  const saveBankDetailsRef = useRef<null | (() => Promise<void>)>(null);

  // Every real payment now invoices itself automatically (see crmPayments.js
  // createReceiptForMilestone) — this manual dialog is only a fallback for a
  // genuine edge case (an ad-hoc charge with no milestone behind it). Even
  // then it shouldn't open blank: pre-fill Amount from the booking's actual
  // outstanding balance and Date to today, so staff are correcting a real
  // number instead of typing one from scratch.
  useEffect(() => {
    if (!invoiceRow?.BookingId) return;
    let cancelled = false;
    setInvoiceLoading(true);
    fetchWithAuth(`/api/crm/bookings/${invoiceRow.BookingId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return;
        const milestones: any[] = d.milestones || [];
        const outstanding = milestones.reduce((s, m) => s + Math.max(0, Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)), 0);
        setInvoiceForm({
          Amount: outstanding > 0 ? String(outstanding) : "",
          InvoiceType: "Booking",
          InvoiceDate: new Date().toISOString().slice(0, 10),
          Description: "",
        });
      })
      .finally(() => { if (!cancelled) setInvoiceLoading(false); });
    return () => { cancelled = true; };
  }, [invoiceRow?.BookingId]);

  const { data: apps = [], isLoading } = useQuery({ queryKey: ["crm-apps"], queryFn: fetchApps, staleTime: 60_000 });
  const { data: viewingAppDetail } = useQuery({
    queryKey: ["crm-app-detail", viewingAppId],
    queryFn: () => fetchAppDetail(viewingAppId as number),
    enabled: !!viewingAppId,
  });
  // Co-applicants now live in their own list keyed by ApplicationId (see
  // crmCoApplicant.js GET /application/:id) rather than as flat
  // CoApplicantName/Relation/Mobile columns on CrmApplication itself.
  const { data: viewingAppCoApplicants = [] } = useQuery({
    queryKey: ["crm-app-co-applicants", viewingAppId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${CO_APPLICANT_API}/application/${viewingAppId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!viewingAppId,
  });
  // Same shape/endpoint as the wizard's own detailParkingAllotments (see
  // ParkingSelectionStep) but keyed by viewingAppId — the read-only preview
  // dialog is a separate query scope from the wizard, so it needs its own
  // fetch to show the Financials card's Parking breakdown.
  const { data: viewingAppParking = [] } = useQuery({
    queryKey: ["crm-app-parking", viewingAppId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/application/${viewingAppId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!viewingAppId,
  });
  const { data: customers = [] } = useQuery({ queryKey: ["crm-customers-dropdown"], queryFn: fetchCustomers, staleTime: 60_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-dropdown"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });
  const { data: companies = [] } = useQuery({ queryKey: ["crm-companies-dropdown"], queryFn: fetchCompanies, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  // Unlike the other dropdowns below (company/project/plan — slow-changing
  // reference data), unit availability changes whenever any salesperson
  // holds or books a unit. Creation and submit both enforce this server-side
  // regardless (see crmEntityCreation.js / crmApplications.js PUT /:id/submit),
  // so this can never let someone actually take an unavailable unit — but a
  // 5-minute staleTime meant this dropdown could keep listing an already-held
  // unit to a second salesperson for that long, who'd then hit a 409 instead
  // of just not seeing it. 30s keeps the common dropdown-render case cheap
  // (no refetch storm) while closing most of that window.
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 30_000 });
  const { data: platforms = [] } = useQuery({ queryKey: ["sa-platforms"], queryFn: fetchPlatforms, staleTime: 5 * 60_000 });
  const { data: campaigns = [] } = useQuery({ queryKey: ["sa-campaigns-dropdown"], queryFn: fetchCampaigns, staleTime: 5 * 60_000 });
  const { data: ads = [] } = useQuery({ queryKey: ["sa-ads-dropdown"], queryFn: fetchAds, staleTime: 5 * 60_000 });
  const { data: channelPartners = [] } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchChannelPartners, staleTime: 5 * 60_000 });
  const { data: brokers = [] } = useQuery({ queryKey: ["crm-brokers-dropdown"], queryFn: fetchBrokers, staleTime: 5 * 60_000 });
  const { data: paymentPlans = [] } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchPaymentPlans, staleTime: 5 * 60_000 });
  const { data: blockPlanTags = [] } = useQuery({ queryKey: ["crm-app-block-plan-tags"], queryFn: fetchBlockPlanTags, staleTime: 5 * 60_000 });
  // Same queryKey ParkingSelectionStep (Step 2) uses for this applicationId
  // — react-query dedupes/caches across the two, so the Details tab (Step
  // 6) can show the parking total without firing its own separate fetch.
  const { data: detailParkingAllotments = [] } = useQuery({
    queryKey: ["crm-app-parking", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!applicationId,
  });
  const detailParkingTotal = (detailParkingAllotments as any[]).reduce((s, a) => s + (Number(a.TotalAmount) || 0), 0);

  const selectedCustomer = useMemo(() =>
    (customers as any[]).find((c: any) => String(c.Id) === form.CustomerId) || null,
    [customers, form.CustomerId]
  );

  // Tree: Company -> Project -> Block -> Floor -> Unit, all derived
  // client-side from the flat UnitMaster list (same lightweight pattern
  // this page already used for Project/Unit before).
  const projectsForCompany = useMemo(() => {
    if (!form.CompanyId) return projects as any[];
    return (projects as any[]).filter((p: any) => String(p.CompanyId) === form.CompanyId);
  }, [projects, form.CompanyId]);
  const unitsForProject = useMemo(() => {
    if (!form.ProjectId) return [];
    // A unit is unavailable the moment it's got an active Booking or an
    // active (non-expired) Hold on it — see unit-master GET /'s
    // LockBookingNo/LockHoldId, the same signals crmApplications.js already
    // uses for the "Unit unavailable" badge. Keep showing this
    // application's own already-picked unit even if it's now locked (that
    // lock is very likely this application's own Draft/Pending hold on
    // itself) so resuming/editing doesn't strand the form on a unit that
    // silently vanished from the list.
    return (units as any[]).filter((u: any) =>
      String(u.ProjectId) === form.ProjectId
      && (!(u.LockBookingNo || u.LockHoldId) || String(u.Id) === form.PreferredUnitId)
    );
  }, [units, form.ProjectId, form.PreferredUnitId]);
  const blocksForProject = useMemo(() => {
    const map = new Map<string, string>();
    unitsForProject.forEach((u: any) => { if (u.BlockId) map.set(String(u.BlockId), u.BlockName); });
    return Array.from(map, ([Id, Name]) => ({ Id, Name }));
  }, [unitsForProject]);
  const unitsForBlock = useMemo(() => {
    if (!form.BlockId) return unitsForProject;
    return unitsForProject.filter((u: any) => String(u.BlockId) === form.BlockId);
  }, [unitsForProject, form.BlockId]);
  const floorsForBlock = useMemo(() => {
    const set = new Set<string>();
    unitsForBlock.forEach((u: any) => { if (u.FloorNo != null) set.add(String(u.FloorNo)); });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [unitsForBlock]);
  const unitsForFloor = useMemo(() => {
    if (!form.FloorNo) return unitsForBlock;
    return unitsForBlock.filter((u: any) => String(u.FloorNo) === form.FloorNo);
  }, [unitsForBlock, form.FloorNo]);
  const selectedUnit = useMemo(() =>
    (units as any[]).find((u: any) => String(u.Id) === form.PreferredUnitId) || null,
    [units, form.PreferredUnitId]
  );
  // Deposit bank picker for the Payment Details section (Details step) —
  // scoped to the Project picked back in step 1, same pattern as
  // CrmBooking.tsx's own "Deposited To" field.
  const { data: projectBanks = [] } = useQuery({
    queryKey: ["crm-application-project-banks", form.ProjectId],
    queryFn: () => fetchProjectBanks(form.ProjectId ? Number(form.ProjectId) : undefined),
    enabled: dialogOpen && !!form.ProjectId,
  });
  const { data: allBanks = [] } = useQuery({
    queryKey: ["bank-master-dropdown"],
    queryFn: fetchAllBanks,
    enabled: dialogOpen,
    staleTime: 5 * 60_000,
  });
  const bankOptions = projectBanks.length > 0 ? projectBanks : allBanks;
  useEffect(() => {
    if (projectBanks.length === 1) {
      setForm((f) => f.DepositBankId ? f : { ...f, DepositBankId: String((projectBanks[0] as any).BId) });
    }
  }, [projectBanks]);
  // Project -> Block -> Unit cascade (see crmEntityCreation.js's
  // getApplicablePaymentPlans, the same source of truth the backend uses to
  // validate the actual save) — stop at the first non-empty tier: the
  // Unit's own tags, else its Block's, else its Project's, else every
  // active plan. Either way a plan must be picked once a unit is on the
  // application — there's no more "leave blank for the default split" option.
  const unitTaggedPaymentPlans = useMemo(() => {
    if (!selectedUnit?.PaymentPlanIds) return [];
    const taggedIds: string[] = String(selectedUnit.PaymentPlanIds).split(",").filter(Boolean);
    return (paymentPlans as any[]).filter((p: any) => p.IsActive && taggedIds.includes(String(p.Id)));
  }, [paymentPlans, selectedUnit]);
  const blockTaggedPaymentPlans = useMemo(() => {
    if (!selectedUnit?.BlockId) return [];
    const blockRow = (blockPlanTags as any[]).find((b: any) => String(b.Id) === String(selectedUnit.BlockId));
    if (!blockRow?.PaymentPlanIds) return [];
    const taggedIds: string[] = String(blockRow.PaymentPlanIds).split(",").filter(Boolean);
    return (paymentPlans as any[]).filter((p: any) => p.IsActive && taggedIds.includes(String(p.Id)));
  }, [paymentPlans, blockPlanTags, selectedUnit]);
  const projectTaggedPaymentPlans = useMemo(() => {
    if (!selectedUnit?.ProjectId) return [];
    return (paymentPlans as any[]).filter((p: any) =>
      p.IsActive && p.ProjectIds && String(p.ProjectIds).split(",").includes(String(selectedUnit.ProjectId)));
  }, [paymentPlans, selectedUnit]);
  const activePaymentPlans = useMemo(() => (paymentPlans as any[]).filter((p: any) => p.IsActive), [paymentPlans]);
  const applicablePaymentPlans = unitTaggedPaymentPlans.length
    ? unitTaggedPaymentPlans
    : blockTaggedPaymentPlans.length
      ? blockTaggedPaymentPlans
      : projectTaggedPaymentPlans.length
        ? projectTaggedPaymentPlans
        : activePaymentPlans;

  // Resume is only meaningful for a genuinely incomplete application. In
  // practice that's Status='Pending' — POST / (createCrmApplicationRecord)
  // inserts new applications straight into 'Pending', not 'Draft', so the
  // Draft check below is kept only for backward compatibility (an older
  // record, or a future path that writes it) and doesn't fire in the normal
  // flow. This used to be guessed from which form fields happened to be
  // empty, which was fragile in both directions: a fully submitted Pending
  // application with a blank (optional) Notes field would incorrectly show
  // Resume, while other field combinations could just as easily fail to show
  // it on a genuinely incomplete one. Status is the real answer; stop guessing.
  const isResumeEditable = (app: any) => !!app && (app.Status === "Draft" || app.Status === "Pending");

  // Same Draft/Pending gate as isResumeEditable, applied inside the open
  // wizard rather than at the Resume button: null status means a brand-new
  // application still being created in step 1 (always editable — nothing
  // saved yet to protect). Once wizardAppStatus is anything else (Approved,
  // Rejected, Cancelled, Expired), the Project/Unit tree's Edit control
  // never renders and the fields stay disabled no matter what unitLocked
  // says — a real Booking either exists or is expected once Approved
  // (createCrmBookingRecord requires it), so the unit pick can't move here
  // anymore; see the comment on APPLICATION_TRANSITIONS in
  // crmApplicationWorkflow.js for why Cancel-and-redo isn't the answer
  // either at that point.
  const canEditUnitSelection = wizardAppStatus === null || wizardAppStatus === "Draft" || wizardAppStatus === "Pending";

  // Mirrors APPLICATION_TRANSITIONS in crmApplicationWorkflow.js: Cancel is a
  // business action any editor can take pre-approval — accidental filing or a
  // mistake means reapplying is cleaner than salvaging the record, and
  // cancelling releases whatever unit/parking hold it was carrying immediately
  // (see PUT /:id/cancel) instead of leaving it tied up until the hold's own
  // expiry. Once Approved, the backend refuses this transition outright — the
  // real Booking's own Cancellation Request flow is the only path from there,
  // so this never shows for an Approved application. The button itself is
  // just a convenience gate; the backend re-checks and is the real guard.
  const canCancelApplication = (app: any) => !!app && !["Approved", "Cancelled", "Expired"].includes(app.Status);

  // Broker Master is the single source of truth for a broker's own identity
  // (name/phone/PAN/RERA) — this app never lets staff retype any of that.
  // Selecting a broker (auto-fetched from the customer, or picked manually)
  // just pulls the already-registered record for read-only display; the
  // ONLY thing staff can ever edit here is the deal-specific commission
  // override % and the before/after-Agreement split.
  const selectedBroker = useMemo(() =>
    (brokers as any[]).find((b: any) => String(b.LHeadId) === form.BrokerId) || null,
    [brokers, form.BrokerId]
  );

  // Campaigns narrow to the selected platform; ads narrow to the selected campaign —
  // the same cascading source chain SaLead already enforces server-side.
  const campaignsForPlatform = useMemo(() => {
    if (!form.PlatformId) return campaigns as any[];
    return (campaigns as any[]).filter((c: any) => String(c.PlatformId) === form.PlatformId);
  }, [campaigns, form.PlatformId]);
  const adsForCampaign = useMemo(() => {
    if (!form.CampaignId) return [];
    return (ads as any[]).filter((a: any) => String(a.CampaignId) === form.CampaignId);
  }, [ads, form.CampaignId]);

  const stageCounts = useMemo(() => {
    const counts: Record<Stage, number> = { InProcess: 0, Converted: 0, NotConverted: 0 };
    for (const a of apps as any[]) if (a.Stage in counts) counts[a.Stage as Stage]++;
    return counts;
  }, [apps]);

  const conversionRate = useMemo(() => {
    const total = stageCounts.Converted + stageCounts.NotConverted;
    return total > 0 ? Math.round((stageCounts.Converted / total) * 100) : 0;
  }, [stageCounts]);

  const filtered = useMemo(() => {
    return (apps as any[]).filter((a: any) => {
      const s = !search || a.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || a.Mobile?.includes(search) || a.ApplicationNo?.includes(search);
      const st = statusFilter === "All" || a.Status === statusFilter;
      const stg = a.Stage === activeStage;
      return s && st && stg;
    });
  }, [apps, search, statusFilter, activeStage]);

  // Which customer's Source the user has explicitly clicked "Change" on —
  // the auto-fetch effect below must never re-lock for that same customer
  // again, or a background refetch of the customers/leads list (new array/
  // object identity, same data) would silently undo the override the
  // moment it re-runs.
  const sourceUnlockedForCustomerRef = useRef<number | null>(null);

  // The moment a customer with a linked lead is picked, auto-fetch that
  // lead's source chain onto the application and lock it (display-only,
  // with a "Change" escape hatch) — this is the customer's real, already-
  // known acquisition source, not something staff should have to re-pick.
  // Only fills fields still blank, so re-selecting a different customer
  // never clobbers something staff already typed. Depends on primitive
  // ids, not the selectedCustomer/leads object references, so a background
  // query refetch (same data, new array identity) doesn't re-fire this and
  // clobber a manual "Change".
  useEffect(() => {
    const custId = selectedCustomer?.Id ?? null;
    const leadId = selectedCustomer?.LeadId ?? null;
    if (!leadId) { setSourceLocked(false); return; }
    if (sourceUnlockedForCustomerRef.current === custId) return;
    const lead = (leads as any[]).find((l: any) => l.Id === leadId);
    if (!lead?.SourceType) { setSourceLocked(false); return; }
    setForm((f) => ({
      ...f,
      Source: f.Source || lead.SourceType || "",
      PlatformId: f.PlatformId || (lead.PlatformId ? String(lead.PlatformId) : ""),
      CampaignId: f.CampaignId || (lead.CampaignId ? String(lead.CampaignId) : ""),
      AdId: f.AdId || (lead.AdId ? String(lead.AdId) : ""),
      ChannelPartnerId: f.ChannelPartnerId || (lead.ChannelPartnerId ? String(lead.ChannelPartnerId) : ""),
    }));
    setSourceLocked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.Id, selectedCustomer?.LeadId]);

  // Rate auto-fills from the unit's own rate if UnitMaster carries one;
  // otherwise stays whatever staff typed (or blank, computed manually).
  useEffect(() => {
    if (selectedUnit?.RatePerSqFt && !form.RatePerSqFt) {
      setForm((f) => ({ ...f, RatePerSqFt: String(selectedUnit.RatePerSqFt) }));
    }
  }, [selectedUnit]);

  // If the unit changes to one with a different (or no) tagged-plan set,
  // clear a PaymentPlanId that no longer applies — e.g. it was one of the
  // old unit's tags but isn't one of the new unit's.
  useEffect(() => {
    if (applicationId) return;
    if (!form.PaymentPlanId) return;
    const stillValid = applicablePaymentPlans.some((p: any) => String(p.Id) === form.PaymentPlanId);
    if (!stillValid) setForm((f) => ({ ...f, PaymentPlanId: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, selectedUnit?.Id]);

  const computedTotal = useMemo(() => {
    const area = Number(selectedUnit?.AreaSqFt) || 0;
    const rate = Number(form.RatePerSqFt) || 0;
    return area && rate ? Math.round(area * rate) : 0;
  }, [selectedUnit, form.RatePerSqFt]);

  // Brief, real-money preview of the plan actually picked — Booking is the
  // plan's own fixed ₹ (never a % — see CrmPaymentPlans.tsx), every
  // milestone after it splits 100% of (computedTotal - BookingAmount), same
  // math generateMilestonesForBooking uses once a real Booking exists.
  const selectedPaymentPlan = useMemo(() =>
    (paymentPlans as any[]).find((p: any) => String(p.Id) === form.PaymentPlanId) || null,
    [paymentPlans, form.PaymentPlanId]
  );
  const selectedPlanMilestones = useMemo(() => parseMilestones(selectedPaymentPlan?.MilestonesJson), [selectedPaymentPlan]);
  const selectedPlanBookingAmount = Number(selectedPaymentPlan?.BookingAmount || 0);
  const selectedPlanRemainder = Math.max(0, computedTotal - selectedPlanBookingAmount);

  // Token Amount defaults to the plan's own fixed Booking Amount the moment
  // a plan is picked — Token Type is no longer a free "Percentage vs Amount"
  // choice (the actual milestone-1 charge was never derived from either;
  // see crmEntityCreation.js), it's just the fixed ₹ figure the plan already
  // sets. Only pre-fills when the field is still untouched, so staff can
  // still overtype it to whatever the customer actually paid — more OR less
  // than this default — which is the one thing this field is genuinely for.
  useEffect(() => {
    if (selectedPlanBookingAmount > 0 && !form.TokenValue) {
      setForm((f) => f.TokenValue ? f : { ...f, TokenType: "Amount", TokenValue: String(selectedPlanBookingAmount) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanBookingAmount]);

  // Preview only — under 1Cr -> 2%, 1Cr and above -> 1%. The real, final
  // percentage/amount is computed server-side off the Booking's actual
  // TotalValue once one exists (see maybeAutoCreateBrokerage in
  // crmWorkflowGuards.js); this just gives staff a rate hint at intake time.
  const brokerageTierDefault = computedTotal >= 10000000 ? 1 : 2;

  const resetWizard = () => {
    setForm({ ...EMPTY_FORM });
    setStep(1);
    setMaxStepReached(1);
    setApplicationId(null);
    setApplicationNo(null);
    // Lock flag/unlock-guard is gated on the form that's about to be blown
    // away — leaving it set would leak into the next customer picked in a
    // freshly-opened wizard (e.g. a stale "unlocked" guard suppressing the
    // auto-fetch for a customer who never actually clicked "Change").
    setSourceLocked(false);
    sourceUnlockedForCustomerRef.current = null;
    // Same reasoning — a brand-new application starts fully unlocked (no
    // saved pick to protect yet) and with no status of its own.
    setWizardAppStatus(null);
    setUnitLocked(false);
  };

  const loadApplicationIntoWizard = async (id: number) => {
    setLoadingApplication(true);
    try {
      const res = await fetchWithAuth(`${API}/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load application");
      }
      const body = await res.json();
      const app = body.application;
      if (!app) throw new Error("Application record missing from response");

      setApplicationId(app.Id);
      setApplicationNo(app.ApplicationNo || null);
      setForm((f) => ({
        ...f,
        CustomerId: app.CustomerId ? String(app.CustomerId) : "",
        CompanyId: app.CompanyId ? String(app.CompanyId) : "",
        ProjectId: app.ProjectId ? String(app.ProjectId) : "",
        BlockId: app.BlockId ? String(app.BlockId) : "",
        PreferredUnitId: app.PreferredUnitId ? String(app.PreferredUnitId) : "",
        PaymentPlanId: app.PaymentPlanId ? String(app.PaymentPlanId) : "",
        RatePerSqFt: app.RatePerSqFt != null ? String(app.RatePerSqFt) : "",
        DateOfApply: app.DateOfApply ? String(app.DateOfApply).slice(0, 10) : new Date().toISOString().slice(0, 10),
        Source: app.Source || "",
        PlatformId: app.PlatformId ? String(app.PlatformId) : "",
        CampaignId: app.CampaignId ? String(app.CampaignId) : "",
        AdId: app.AdId ? String(app.AdId) : "",
        ChannelPartnerId: app.ChannelPartnerId ? String(app.ChannelPartnerId) : "",
        ViaBroker: !!app.BrokerId,
        BrokerId: app.BrokerId ? String(app.BrokerId) : "",
        BrokerageRatePercent: app.BrokerageRatePercent != null ? String(app.BrokerageRatePercent) : "",
        BrokerageSplitEnabled: !!app.BrokerageSplitEnabled,
        Notes: app.Notes || "",
        TokenType: app.TokenType || "Percentage",
        TokenValue: app.TokenValue != null ? String(app.TokenValue) : "",
        PaymentMode: app.PaymentMode || "",
        DepositBankId: app.DepositBankId ? String(app.DepositBankId) : "",
      }));
      setSourceLocked(!!app.Source && !!app.PlatformId);
      setWizardAppStatus(app.Status || null);

      const hasProject = !!app.CompanyId && !!app.ProjectId && !!app.PreferredUnitId;
      // Lock the Project/Unit tree the same way Source locks once
      // auto-fetched — there's already a saved pick here, so default to
      // showing it read-only with an Edit control rather than inviting an
      // accidental reselection every time the wizard is reopened. Resume is
      // only ever reachable for Draft/Pending (see isResumeEditable), so
      // Edit is always available here in practice; canEditUnitSelection
      // below still gates it defensively in case that ever changes.
      setUnitLocked(hasProject);
      // CurrentStep is the furthest step this application actually reached
      // (persisted by saveApplicationFields on every "Next" — see
      // handleCreateAndNext/handleBankDetailsNext/handleCoApplicantNext/
      // handleAttachmentsNext below). Resume there instead of hardcoding
      // Parking (step 2) every time — e.g. an application that already has
      // Bank/KYC, Co-Applicant, and Attachments done, sitting only on
      // Details awaiting approval, reopens straight on Details (step 6)
      // rather than making staff click back through everything again.
      // Still clamped: never below step 2 once a project/unit exists (step 1
      // is already done), never above 6, never above 1 without one.
      const savedStep = Number(app.CurrentStep) || 1;
      const resumeStep = hasProject ? Math.min(6, Math.max(2, savedStep)) : 1;
      setStep(resumeStep);
      setMaxStepReached(resumeStep);
      setDialogOpen(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingApplication(false);
    }
  };

  // Step 1 -> creates the real Application record (a document-upload/bank-
  // detail/parking capture can't happen against a record that doesn't
  // exist yet) — every step after this edits/attaches to that same id.
  const handleCreateAndNext = async () => {
    if (!form.CustomerId) { toast.error("Select a customer"); return; }
    if (!form.CompanyId || !form.ProjectId) { toast.error("Select a company and project"); return; }
    if (!form.PreferredUnitId) { toast.error("Select a unit"); return; }
    if (form.RatePerSqFt === "" || Number(form.RatePerSqFt) <= 0) { toast.error("Enter a valid Rate (₹/sqft)"); return; }
    if (!form.PaymentPlanId) { toast.error("Select a Payment Plan for this unit"); return; }
    setSaving(true);
    try {
      // Shared Company/Project/Unit/Payment Plan + intake fields step 1 owns.
      // CustomerId is deliberately excluded from the shared payload — it's
      // permanently locked once an application exists (see the Customer
      // select's disabled={!!applicationId} above) and PUT /:id doesn't
      // accept it, only POST does on first creation.
      const step1Fields = {
        CompanyId: form.CompanyId || null,
        ProjectId: form.ProjectId || null,
        PreferredUnitId: form.PreferredUnitId || null,
        PaymentPlanId: form.PaymentPlanId || null,
        RatePerSqFt: form.RatePerSqFt || null,
        DateOfApply: form.DateOfApply || null,
        Source: form.Source || null,
        PlatformId: form.PlatformId || null,
        CampaignId: form.CampaignId || null,
        AdId: form.AdId || null,
        ChannelPartnerId: form.ChannelPartnerId || null,
        BrokerId: form.ViaBroker && form.BrokerId ? parseInt(form.BrokerId) : null,
        BrokerageRatePercent: form.ViaBroker && form.BrokerageRatePercent !== "" ? form.BrokerageRatePercent : null,
        BrokerageSplitEnabled: form.ViaBroker ? !!form.BrokerageSplitEnabled : false,
      };

      if (applicationId) {
        // Already exists (Resume) — this is an edit to an already-saved
        // pick (only reachable at all while unitLocked was toggled off via
        // Edit, which itself only renders pre-approval), so PUT the change
        // against the existing record. POSTing here instead — the old,
        // unconditional behavior — would have silently created a second,
        // duplicate Application every time step 1 was revisited and saved.
        const res = await fetchWithAuth(`${API}/${applicationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(step1Fields),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to save changes");
        setUnitLocked(true);
        toast.success("Project/Unit selection updated");
        if (form.PreferredUnitId) qc.invalidateQueries({ queryKey: ["unit-master"] });
        advanceStep(2);
        return;
      }

      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CustomerId: parseInt(form.CustomerId), ...step1Fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create application");
      setApplicationId(data.id);
      setApplicationNo(data.ApplicationNo);
      // Freshly created — always Draft, and stays unlocked since this is the
      // same step-1 pick that was just made, not yet a saved value to guard.
      setWizardAppStatus("Draft");
      setUnitLocked(false);
      toast.success(`Application ${data.ApplicationNo} created`);
      // A hold on the picked unit is placed server-side as part of creation
      // (see createCrmApplicationRecord) — refresh so this session's own
      // dropdown reflects it right away rather than waiting out staleTime.
      if (form.PreferredUnitId) qc.invalidateQueries({ queryKey: ["unit-master"] });
      // applicationId (state) won't be updated yet on this render, so
      // advanceStep's saveApplicationFields (which reads applicationId
      // from state) would no-op — patch CurrentStep directly against the
      // id we just got back instead.
      setStep(2);
      setMaxStepReached((m) => Math.max(m, 2));
      fetchWithAuth(`${API}/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CurrentStep: 2 }),
      }).catch(() => {});
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Steps 2-4 save against the real applicationId as staff move forward —
  // each "Next" just persists whatever that step owns.
  const saveApplicationFields = async (patch: Record<string, any>) => {
    if (!applicationId) return;
    const res = await fetchWithAuth(`${API}/${applicationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Save failed"); }
  };

  // Moves forward and persists CurrentStep (fire-and-forget — a failed save
  // of the progress marker shouldn't block navigation the user already
  // completed) so Resume and the clickable tabs both know how far this
  // application has actually gotten, instead of Resume always guessing.
  const advanceStep = (n: number) => {
    setStep(n);
    setMaxStepReached((m) => Math.max(m, n));
    saveApplicationFields({ CurrentStep: n }).catch(() => {});
  };

  const handleBankDetailsNext = async () => {
    setSaving(true);
    try {
      await saveBankDetailsRef.current?.();
      advanceStep(4);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalSave = async () => {
    // Same mandatory-bank rule as every other place money moves in this
    // app (CrmBooking.tsx, CrmBookingDetail.tsx, CrmPaymentMilestones.tsx):
    // if the project has tagged banks (or even just the open bank list is
    // non-empty), a bank must be picked before this can go through — only
    // gated when a real token amount is actually being captured.
    if (form.TokenValue && bankOptions.length > 0 && !form.DepositBankId) {
      toast.error("Select which company bank this application's token payment landed in");
      return;
    }
    setSaving(true);
    try {
      await saveApplicationFields({
        Notes: form.Notes || null,
        TokenType: form.TokenType || null,
        TokenValue: form.TokenValue || null,
        PaymentMode: form.PaymentMode || null,
        DepositBankId: form.DepositBankId || null,
      });
      // Actually submits the application — this is what triggers the 72h
      // auto-hold on the picked Unit/Parking server-side, AND now also
      // attempts to create the Booking straight away (see crmApplications.js
      // PUT /:id/submit) — there is no separate admin-approval step in
      // between anymore. Before this call the wizard only ever PUT
      // individual step fields; nothing marked the application as "fully
      // filed."
      const subRes = await fetchWithAuth(`${API}/${applicationId}/submit`, { method: "PUT" });
      const subData = await subRes.json().catch(() => ({}));
      if (!subRes.ok) throw new Error(subData.error || "Submit failed");
      setDialogOpen(false);
      resetWizard();
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      qc.invalidateQueries({ queryKey: ["unit-master"] });
      if (subData.booking?.BookingNo) {
        // Booking auto-created — go straight to it instead of leaving staff
        // to find it themselves, matching the "no approval step in between"
        // change: Application submitted -> Booking exists -> Booking page.
        toast.success(`Booking ${subData.booking.BookingNo} created — payment milestones auto-generated`);
        navigate(`/crm/bookings?applicationId=${applicationId}`);
      } else if (subData.bookingError) {
        // Auto-create failed (e.g. a unit-hold conflict in the interim) —
        // the Application itself still submitted fine; staff can retry via
        // the "Create Booking" button on the Applications list.
        toast.warning(`Application submitted, but the booking couldn't be created automatically: ${subData.bookingError}`);
      } else {
        toast.success("Application submitted");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!invoiceRow) return;
    const amount = parseFloat(invoiceForm.Amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Amount must be greater than 0"); return; }
    setInvoiceSaving(true);
    try {
      const res = await fetchWithAuth(`/api/crm/bookings/${invoiceRow.BookingId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Amount: amount,
          InvoiceType: invoiceForm.InvoiceType,
          InvoiceDate: invoiceForm.InvoiceDate || undefined,
          Description: invoiceForm.Description || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to generate invoice");
      toast.success("Booking invoice generated");
      setInvoiceRow(null);
      setInvoiceForm({ Amount: "", InvoiceType: "Booking", InvoiceDate: "", Description: "" });
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setInvoiceSaving(false);
    }
  };

  // The manual retry path — Submitting an Application already auto-creates
  // its Booking (see crmApplications.js PUT /:id/submit); this exists purely
  // for when that auto-create didn't happen (no unit picked yet at submit
  // time, or a stale hold conflict) — there is no separate "New Booking"
  // form anywhere else in the app.
  const [creatingBookingId, setCreatingBookingId] = useState<number | null>(null);

  // Cancel confirmation state — a destructive, one-way action (backend has no
  // "un-cancel"), so this always goes through a confirm dialog rather than
  // firing straight off a row-action click.
  const [cancellingApp, setCancellingApp] = useState<any | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const handleCancelApplication = async () => {
    if (!cancellingApp) return;
    setCancelling(true);
    try {
      const res = await fetchWithAuth(`${API}/${cancellingApp.Id}/cancel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: cancelRemarks.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel application");
      toast.success("Application cancelled — any unit/parking hold has been released");
      const cancelledId = cancellingApp.Id;
      setCancellingApp(null);
      setCancelRemarks("");
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      // The hold this application was carrying is released server-side the
      // instant cancel succeeds — refresh unit data so it's immediately
      // pickable again instead of waiting out unit-master's staleTime.
      qc.invalidateQueries({ queryKey: ["unit-master"] });
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      if (viewingAppId === cancelledId) qc.invalidateQueries({ queryKey: ["crm-app-detail", cancelledId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCancelling(false);
    }
  };
  const handleCreateBooking = async (a: any) => {
    if (!a.PreferredUnitId) {
      toast.error("This application has no unit selected — edit it and pick a unit before a booking can be created");
      return;
    }
    setCreatingBookingId(a.Id);
    try {
      const res = await fetchWithAuth("/api/crm/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: a.Id, UnitId: a.PreferredUnitId, RatePerSqFt: a.RatePerSqFt,
          PaymentPlanId: a.PaymentPlanId, BookingDate: a.DateOfApply, TokenType: a.TokenType,
          TokenValue: a.TokenValue, BookingAmount: a.BookingAmount, PaymentMode: a.PaymentMode,
          DepositBankId: a.DepositBankId,
          AssignedTo: a.AssignedTo, Notes: a.Notes,
          BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokerageSplitEnabled: a.BrokerageSplitEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create booking");
      toast.success(`Booking ${data.BookingNo} created — payment milestones auto-generated`);
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      navigate(`/crm/bookings?applicationId=${a.Id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingBookingId(null);
    }
  };

  const convertedColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ApplicationNo", header: "App No", size: 110,
      cell: (i) => (
        <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer font-mono text-xs font-semibold text-primary hover:underline">
          {i.getValue() as string}
        </span>
      ) },
    { accessorKey: "ApplicantName", header: "Applicant", size: 160,
      cell: (i) => (
        <div onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium text-foreground">{i.row.original.ApplicantName}</div>
          {i.row.original.LeadUid && <div className="text-xs text-muted-foreground">Lead: {i.row.original.LeadUid}</div>}
        </div>
      ) },
    { accessorKey: "Mobile", header: "Mobile", size: 110,
      cell: (i) => <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "BookingNo", header: "Booking", size: 140,
      cell: (i) => (
        <div onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer">
          <div className="font-mono text-xs font-semibold text-foreground">{i.row.original.BookingNo}</div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-green-600 bg-green-50 border-green-200">{i.row.original.BookingStatus}</span>
        </div>
      ) },
    { id: "unitProject", header: "Unit / Project", size: 140, enableSorting: false,
      cell: (i) => (
        <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-xs">
          {[i.row.original.BookingProjectName, i.row.original.BookingUnitNo].filter(Boolean).join(" · ") || "—"}
        </span>
      ) },
    { accessorKey: "BookingTotalValue", header: "Value", size: 110,
      cell: (i) => {
        const val = i.row.original.BookingGrandTotal ?? i.row.original.BookingTotalValue;
        return <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-xs font-medium">{val ? `₹${Number(val).toLocaleString("en-IN")}` : "—"}</span>;
      } },
    { accessorKey: "BookingDate", header: "Booked On", size: 110,
      cell: (i) => (
        <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-xs text-muted-foreground">
          {i.row.original.BookingDate ? String(i.row.original.BookingDate).slice(0, 10) : "—"}
        </span>
      ) },
    { id: "actions", header: "", size: 180, enableSorting: false,
      cell: (i) => (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate(`/crm/bookings?applicationId=${i.row.original.Id}`)}
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Building2 size={12} /> View Booking <ChevronRight size={12} />
          </button>
          <button
            onClick={() => setInvoiceRow(i.row.original)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <FileText size={12} /> Generate Invoice
          </button>
        </div>
      ) },
  ];

  const inProcessColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ApplicationNo", header: "App No", size: 110,
      cell: (i) => (
        <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer font-mono text-xs font-semibold text-primary hover:underline">
          {i.getValue() as string}
        </span>
      ) },
    { accessorKey: "ApplicantName", header: "Applicant", size: 150,
      cell: (i) => (
        <div onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium text-foreground">{i.row.original.ApplicantName}</div>
          {i.row.original.LeadUid && <div className="text-xs text-muted-foreground">Lead: {i.row.original.LeadUid}</div>}
        </div>
      ) },
    { accessorKey: "Mobile", header: "Mobile", size: 100,
      cell: (i) => <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-muted-foreground">{i.getValue() as string}</span> },
    { id: "interestedProject", header: "Interested Project", size: 140, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        const typeBit = [r.BhkPreference, r.PropertyType].filter(Boolean).join(" · ") || r.UnitTypeFromMaster || "";
        return (
          <span onClick={() => setViewingAppId(r.Id)} className="cursor-pointer">
            {[r.InterestedProject, typeBit].filter(Boolean).join(" · ") || "—"}
          </span>
        );
      } },
    { accessorKey: "Source", header: "Source", size: 130,
      cell: (i) => (
        <div onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-xs">
          <div>{i.row.original.Source || "—"}</div>
          <div className="text-muted-foreground">
            {[i.row.original.PlatformName, i.row.original.CampaignName, i.row.original.AdName].filter(Boolean).join(" › ") || i.row.original.ChannelPartnerName || ""}
          </div>
        </div>
      ) },
    { accessorKey: "RatePerSqFt", header: "Rate", size: 100,
      cell: (i) => <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-xs">{i.row.original.RatePerSqFt ? `₹${Number(i.row.original.RatePerSqFt).toLocaleString("en-IN")}/sqft` : "—"}</span> },
    { accessorKey: "AssigneeName", header: "Assigned To", size: 110,
      cell: (i) => <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-sm">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span onClick={() => setViewingAppId(i.row.original.Id)} className={`cursor-pointer text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { accessorKey: "CreatedAt", header: "Date", size: 100,
      cell: (i) => (
        <span onClick={() => setViewingAppId(i.row.original.Id)} className="cursor-pointer text-xs text-muted-foreground">
          {i.row.original.CreatedAt ? String(i.row.original.CreatedAt).slice(0, 10) : "—"}
        </span>
      ) },
    { id: "actions", header: "", size: 230, enableSorting: false,
      cell: (i) => {
        const a = i.row.original;
        const canResume = activeStage === "InProcess" && isResumeEditable(a);
        return (
          <div className="flex flex-col gap-1.5 py-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeStage === "InProcess" ? (
                <>
                  {canResume && (
                    <button
                      onClick={() => loadApplicationIntoWizard(a.Id)}
                      disabled={loadingApplication}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-primary/20 bg-primary/5 text-primary font-medium hover:bg-primary/10 disabled:opacity-40 transition-colors"
                    >
                      <PlayCircle size={12} /> {loadingApplication ? "Loading..." : "Resume"}
                    </button>
                  )}
                  {/* There is no Application-level Approve/Reject anymore —
                      this renders nothing for a normal Pending application
                      (submitOnly hides Approve/Reject even if status were
                      Pending, and Approved/Cancelled/Expired render nothing
                      either way). It only still shows a "Submit" button for
                      the legacy case of an application some old data has
                      sitting at Rejected — a real resubmit back to Pending,
                      see crmApplications.js PUT /:id/submit. */}
                  <ApprovalActions
                    status={a.Status}
                    recordId={a.Id}
                    endpoint={API}
                    submitOnly
                    onSuccess={(_action, data) => {
                      qc.invalidateQueries({ queryKey: ["crm-apps"] });
                      if (data?.bookingError) qc.invalidateQueries({ queryKey: ["unit-master"] });
                    }}
                  />
                  {/* Submitting the Application auto-creates the Booking; this
                      only ever shows up when that auto-create didn't happen
                      (no unit was picked yet, or a unit-hold conflict at the
                      time) — the sole retry path, no separate "New Booking"
                      form exists anywhere else. */}
                  {!["Rejected", "Cancelled", "Expired"].includes(a.Status) && a.Stage !== "Converted" && (
                    a.UnitUnavailableForBooking ? (
                      <span
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border text-red-600 border-red-200 bg-red-50 font-medium"
                        title="This application's picked unit is currently booked or held by a different application — re-pick a unit before a booking can be created."
                      >
                        <XCircle size={12} /> Unit unavailable
                      </span>
                    ) : (
                      <button
                        onClick={() => handleCreateBooking(a)}
                        disabled={creatingBookingId === a.Id}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border text-primary border-primary/20 bg-primary/5 font-medium hover:bg-primary/10 disabled:opacity-40"
                      >
                        <Building2 size={12} /> {creatingBookingId === a.Id ? "Creating..." : "Create Booking"}
                      </button>
                    )
                  )}
                  {canCancelApplication(a) && (
                    <button
                      onClick={() => { setCancellingApp(a); setCancelRemarks(""); }}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                    >
                      <Ban size={12} /> Cancel
                    </button>
                  )}
                </>
              ) : (
                canCancelApplication(a) && (
                  <button
                    onClick={() => { setCancellingApp(a); setCancelRemarks(""); }}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                  >
                    <Ban size={12} /> Cancel
                  </button>
                )
              )}
            </div>
            {/* Status hint lives on its own line as a plain caption, never
                inline with the buttons — that inline mixing (a link, a
                sentence, another link, all wrapping unpredictably in a
                210px cell) was what made this column look broken. */}
            {activeStage === "InProcess" && a.Status === "Pending" && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock size={10} /> Pending admin approval
              </span>
            )}
            {activeStage !== "InProcess" && !canCancelApplication(a) && (
              <span className="text-[11px] text-muted-foreground">{a.Status} — no further action</span>
            )}
          </div>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Applications"
      subtitle="Every detail captured once, here — Bookings is review-only from this point on"
      action={
        <button onClick={() => { resetWizard(); setDialogOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={14} /> New Application
        </button>
      }
    >
      {/* ── Pipeline stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "In Process", value: stageCounts.InProcess, dot: "bg-blue-400" },
          { label: "Converted", value: stageCounts.Converted, dot: "bg-green-500" },
          { label: "Not Converted", value: stageCounts.NotConverted, dot: "bg-red-400" },
          { label: "Conversion Rate", value: `${conversionRate}%`, dot: "bg-violet-500" },
        ].map(({ label, value, dot }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
            <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Stage tabs ── */}
      <div className="flex items-center gap-1.5 border-b border-border">
        {STAGES.map((stg) => {
          const Icon = stageIcon[stg];
          const active = activeStage === stg;
          return (
            <button key={stg} onClick={() => setActiveStage(stg)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <Icon size={14} /> {stageLabel[stg]}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                {stageCounts[stg]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, app no..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        {activeStage !== "Converted" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
            <option value="All">All Statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* ── Table — sortable via DataTable; filtering stays the purpose-built
          search box + status/stage controls above, so DataTable's own global
          search is disabled to avoid a second, redundant search box. ── */}
      <DataTable
        data={filtered}
        columns={activeStage === "Converted" ? convertedColumns : inProcessColumns}
        searchable={false}
        loading={isLoading}
        emptyMessage={activeStage === "Converted" ? "No converted applications yet" : activeStage === "NotConverted" ? "No rejected/cancelled applications" : "No applications in process"}
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* New Application Dialog — 5-step wizard: what the customer is
          applying for (unit/parking/KYC/docs). No money changes hands or
          gets recorded here — that's entirely the Booking page's job. */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetWizard(); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              New CRM Application {applicationNo ? `— ${applicationNo}` : ""}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator — each tab is clickable navigation to any step
              already reached (maxStepReached), so staff can jump straight
              back to e.g. Co-Applicant without walking Next through Parking
              and Bank/KYC again. A step beyond what's been reached yet isn't
              clickable — steps 2-6 all need applicationId (created in step 1)
              and Bank/KYC intentionally still gates via its own Next/Save. */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            {["Project/Unit", "Parking", "Bank/KYC", "Co-Applicant", "Attachments", "Details"].map((label, i) => {
              const stepNum = i + 1;
              const reachable = stepNum === 1 || (!!applicationId && stepNum <= maxStepReached);
              return (
                <React.Fragment key={label}>
                  {i > 0 && <div className="flex-1 h-px bg-border" />}
                  <button
                    type="button"
                    onClick={() => reachable && setStep(stepNum)}
                    disabled={!reachable}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full font-medium transition-colors ${
                      step === stepNum ? "bg-primary text-primary-foreground" : step > stepNum ? "text-green-600" : "text-muted-foreground"
                    } ${reachable ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed opacity-60"}`}>
                    {step > stepNum ? <CheckCircle2 size={12} /> : <span className="w-4 text-center">{stepNum}</span>}
                    {label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls}>Customer *</label>
                  <a href="/crm/customers" target="_blank" rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    <ExternalLink size={11} /> New Customer
                  </a>
                </div>
                <select value={form.CustomerId} onChange={(e) => setForm((f) => ({ ...f, CustomerId: e.target.value }))}
                  className={inputCls} disabled={!!applicationId}>
                  <option value="">Select customer</option>
                  {(customers as any[]).map((c: any) => (
                    <option key={c.Id} value={String(c.Id)}>{c.CustomerName} · {c.Mobile} · {c.CustomerNo}</option>
                  ))}
                </select>
                {selectedCustomer && (
                  <div className="mt-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-foreground"><IdCard size={12} className="text-primary" /> {selectedCustomer.CustomerName}</div>
                    <div className="text-muted-foreground">{selectedCustomer.Mobile}{selectedCustomer.Email ? ` · ${selectedCustomer.Email}` : ""}</div>
                    <div className="text-muted-foreground">PAN: {selectedCustomer.PanNo || "—"} · {selectedCustomer.Address || "No address on file"}</div>
                  </div>
                )}
              </div>

              {/* Tree: Company > Project > Block > Floor > Unit. Locked
                  (read-only-styled, disabled) once a pick is already saved,
                  same as Source below — "Edit" unlocks it for changes made
                  before approval. Once the application is past Draft/Pending
                  (canEditUnitSelection false), Edit never renders at all and
                  every field here stays permanently disabled — a real
                  Booking either exists or is expected the moment it's
                  Approved, so the unit pick can't move anymore. */}
              <div className="rounded-lg border border-border p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground block">Project / Unit (tree)</label>
                  {!!applicationId && (
                    canEditUnitSelection ? (
                      unitLocked && (
                        <button type="button" onClick={() => setUnitLocked(false)}
                          className="text-xs text-primary hover:underline shrink-0">
                          Edit
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                        <Lock size={11} /> Locked ({wizardAppStatus})
                      </span>
                    )
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Company *</label>
                    <select value={form.CompanyId} disabled={!!applicationId && (unitLocked || !canEditUnitSelection)}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", BlockId: "", FloorNo: "", PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select company</option>
                      {(companies as any[]).map((c: any) => <option key={c.Id} value={String(c.Id)}>{c.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Project *</label>
                    <select value={form.ProjectId} disabled={!!applicationId && (unitLocked || !canEditUnitSelection)}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, ProjectId: e.target.value, BlockId: "", FloorNo: "", PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select project</option>
                      {(projectsForCompany as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Block / Tower</label>
                    <select value={form.BlockId} disabled={!!applicationId && (unitLocked || !canEditUnitSelection)}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, BlockId: e.target.value, FloorNo: "", PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select block</option>
                      {blocksForProject.map((b) => <option key={b.Id} value={b.Id}>{b.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Floor</label>
                    <select value={form.FloorNo} disabled={!!applicationId && (unitLocked || !canEditUnitSelection)}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, FloorNo: e.target.value, PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select floor</option>
                      {floorsForBlock.map((fl) => <option key={fl} value={fl}>Floor {fl}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Unit *</label>
                    <select value={form.PreferredUnitId} disabled={!!applicationId && (unitLocked || !canEditUnitSelection)}
                      onChange={(e) => {
                        // Unit can be picked before Block/Floor are chosen —
                        // the dropdown already falls back to the full
                        // project's unit list when they're empty (see
                        // unitsForBlock/unitsForFloor). Whichever way it was
                        // reached, backfill Block/Floor from the picked
                        // unit's own record so downstream logic that keys off
                        // them (Parking's blockId scoping, Block-tagged
                        // Payment Plans) still narrows correctly instead of
                        // silently staying project-wide.
                        const picked = (unitsForProject as any[]).find((u: any) => String(u.Id) === e.target.value);
                        setForm((f) => ({
                          ...f,
                          PreferredUnitId: e.target.value,
                          BlockId: picked?.BlockId != null ? String(picked.BlockId) : f.BlockId,
                          FloorNo: picked?.FloorNo != null ? String(picked.FloorNo) : f.FloorNo,
                          PaymentPlanId: "",
                        }));
                      }}
                      className={inputCls}>
                      <option value="">Select unit</option>
                      {(unitsForFloor as any[]).map((u: any) => (
                        <option key={u.Id} value={String(u.Id)}>{u.UnitName} · {u.UnitType || "—"} · {u.AreaSqFt ? `${u.AreaSqFt} sqft` : "—"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Brief unit price — the unit's own name/type/area is
                    already visible in the Unit dropdown right above, so
                    this only needs to show the derived ₹ math itself. */}
                {selectedUnit && (
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
                    <IndianRupee size={11} className="text-primary shrink-0" />
                    {form.RatePerSqFt && computedTotal ? (
                      <span>
                        {selectedUnit.AreaSqFt} sqft × ₹{Number(form.RatePerSqFt).toLocaleString("en-IN")}/sqft = <span className="font-semibold text-foreground">₹{computedTotal.toLocaleString("en-IN")}</span>
                      </span>
                    ) : (
                      <span>Enter Rate (₹/sqft) below to see the full price.</span>
                    )}
                  </div>
                )}

                {/* Payment Plan — mandatory the moment a unit is picked.
                    Options are this unit's own tagged plans (set in Unit
                    Master); if the unit has none tagged, every active plan
                    is offered instead. Not re-selectable on the Booking
                    page — this is the one place it's chosen. */}
                {form.PreferredUnitId && (
                  <div className="pt-2">
                    <label className={labelCls}>Payment Plan <span className="text-destructive">*</span></label>
                    <select value={form.PaymentPlanId} disabled={!!applicationId && (unitLocked || !canEditUnitSelection)}
                      onChange={(e) => setForm((f) => ({ ...f, PaymentPlanId: e.target.value }))} className={inputCls}>
                      <option value="">Select a payment plan</option>
                      {applicablePaymentPlans.map((p: any) => (
                        <option key={p.Id} value={String(p.Id)}>{p.PlanName}</option>
                      ))}
                    </select>
                    {!unitTaggedPaymentPlans.length && blockTaggedPaymentPlans.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">This unit has no payment plans of its own — showing its Block's tagged plans.</p>
                    )}
                    {!unitTaggedPaymentPlans.length && !blockTaggedPaymentPlans.length && projectTaggedPaymentPlans.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">This unit's Block has no payment plans of its own — showing its Project's tagged plans.</p>
                    )}
                    {!unitTaggedPaymentPlans.length && !blockTaggedPaymentPlans.length && !projectTaggedPaymentPlans.length && (
                      <p className="text-[11px] text-muted-foreground mt-1">No payment plans tagged anywhere in this unit's hierarchy — showing every active plan instead.</p>
                    )}

                    {/* Brief plan breakdown — Booking is the plan's own
                        fixed ₹ (never a %), everything after it splits
                        100% of (Total Value - Booking) the same way
                        generateMilestonesForBooking computes it for a real
                        Booking. Purely a preview here — nothing is saved
                        until the actual Booking is created. */}
                    {selectedPaymentPlan && selectedPlanMilestones.length > 0 && (
                      <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Booking</span>
                          <span className="font-semibold text-foreground">₹{selectedPlanBookingAmount.toLocaleString("en-IN")}</span>
                        </div>
                        {selectedPlanMilestones.slice(1).map((m, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="truncate pr-2">{m.name} <span className="text-[10px]">({m.pct}%)</span></span>
                            <span className="font-semibold text-foreground shrink-0">
                              {computedTotal ? `₹${Math.round((selectedPlanRemainder * m.pct) / 100).toLocaleString("en-IN")}` : "—"}
                            </span>
                          </div>
                        ))}
                        {!computedTotal && (
                          <p className="text-[10px] text-muted-foreground pt-0.5">Enter Rate (₹/sqft) to see ₹ amounts for each step.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Date of Apply</label>
                  <input type="date" value={form.DateOfApply} onChange={(e) => setForm((f) => ({ ...f, DateOfApply: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Rate (₹/sqft) <span className="text-destructive">*</span></label>
                  <input type="number" value={form.RatePerSqFt} onChange={(e) => setForm((f) => ({ ...f, RatePerSqFt: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Est. Total Value</label>
                  <input type="text" readOnly value={computedTotal ? `₹${computedTotal.toLocaleString("en-IN")}` : "—"}
                    className={`${inputCls} bg-muted/30 text-muted-foreground`} />
                </div>
              </div>


              {/* Source — deep chain, not a flat label. Auto-fetched and
                  locked when the selected customer has a linked lead with a
                  known source; "Change" unlocks it for the rarer case this
                  application's real source differs from that lead's. */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <label className="text-xs font-semibold text-foreground block">Source</label>
                {sourceLocked ? (
                  <div className="flex items-center justify-between gap-2 bg-muted/30 rounded px-2 py-1.5">
                    <span className="text-sm text-foreground">{form.Source || "—"} <span className="text-xs text-muted-foreground">(auto-fetched from lead)</span></span>
                    <button type="button" onClick={() => { sourceUnlockedForCustomerRef.current = selectedCustomer?.Id ?? null; setSourceLocked(false); }}
                      className="text-xs text-primary hover:underline shrink-0">
                      Change
                    </button>
                  </div>
                ) : (
                  <select value={form.Source}
                    onChange={(e) => setForm((f) => ({ ...f, Source: e.target.value, PlatformId: "", CampaignId: "", AdId: "", ChannelPartnerId: "" }))}
                    className={inputCls}>
                    <option value="">Select source</option>
                    {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}

                {form.Source === "Ad" && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>Platform</label>
                      <select value={form.PlatformId}
                        onChange={(e) => setForm((f) => ({ ...f, PlatformId: e.target.value, CampaignId: "", AdId: "" }))}
                        className={inputCls}>
                        <option value="">Select</option>
                        {(platforms as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Campaign</label>
                      <select value={form.CampaignId}
                        onChange={(e) => setForm((f) => ({ ...f, CampaignId: e.target.value, AdId: "" }))}
                        className={inputCls}>
                        <option value="">Select</option>
                        {(campaignsForPlatform as any[]).map((c: any) => <option key={c.Id} value={String(c.Id)}>{c.Name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Ad</label>
                      <select value={form.AdId} onChange={(e) => setForm((f) => ({ ...f, AdId: e.target.value }))} className={inputCls}>
                        <option value="">Select</option>
                        {(adsForCampaign as any[]).map((a: any) => <option key={a.Id} value={String(a.Id)}>{a.Name}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {form.Source === "Referral" && (
                  <div>
                    <label className={labelCls}>Channel Partner</label>
                    <select value={form.ChannelPartnerId} onChange={(e) => setForm((f) => ({ ...f, ChannelPartnerId: e.target.value }))} className={inputCls}>
                      <option value="">Select channel partner</option>
                      {(channelPartners as any[]).map((cp: any) => <option key={cp.Id} value={String(cp.Id)}>{cp.Name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Broker — separate from Source/Channel Partner. A deal can
                  come from a Referral source AND still be brokered; the two
                  concepts are unrelated (see CrmBrokerageMaster). The broker
                  is introduced right here, at Application time — always
                  picked from Broker Master (AccountHeadMaster, LHeadType=BR),
                  never a fresh Customer-level concept. His own identity
                  (name/phone/PAN/RERA) is never re-typed, only ever selected
                  and shown read-only. The ONLY editable field on this whole
                  block is the per-deal commission override % — everything
                  else is fetched, not entered. The rate here is captured now
                  but only becomes a real commission schedule once Milestone
                  #1 is paid (maybeAutoCreateBrokerage), at which point it's
                  split into one tranche per payment milestone, each
                  unlocking as that milestone is paid — not a manual toggle
                  here. */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <input type="checkbox" checked={form.ViaBroker}
                    onChange={(e) => setForm((f) => ({ ...f, ViaBroker: e.target.checked, ...(e.target.checked ? {} : { BrokerId: "", BrokerageRatePercent: "" }) }))} />
                  Via Broker
                </label>
                {form.ViaBroker && (
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>Broker (from Broker Master)</label>
                      <select value={form.BrokerId} onChange={(e) => setForm((f) => ({ ...f, BrokerId: e.target.value }))} className={inputCls}>
                        <option value="">Select broker</option>
                        {(brokers as any[]).map((b: any) => <option key={b.LHeadId} value={String(b.LHeadId)}>{b.LHeadName}</option>)}
                      </select>
                    </div>

                    {/* Read-only, auto-fetched from Broker Master the moment a
                        broker is on the form — mirrors the Supplier info card
                        pattern used on Purchase Orders (PurchaseOrderMaster.tsx).
                        Nothing in here is ever an editable input. */}
                    {selectedBroker && (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/20 border border-border p-3 text-sm">
                        {selectedBroker.LHeadPhone && (
                          <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Phone</dt>
                            <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5"><Phone size={12} className="text-muted-foreground" />{selectedBroker.LHeadPhone}</dd>
                          </div>
                        )}
                        {selectedBroker.LHeadPan && (
                          <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">PAN</dt>
                            <dd className="text-foreground font-mono text-xs font-medium mt-0.5 flex items-center gap-1.5"><IdCard size={12} className="text-muted-foreground" />{selectedBroker.LHeadPan}</dd>
                          </div>
                        )}
                        {selectedBroker.LHeadRera && (
                          <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">RERA No.</dt>
                            <dd className="text-foreground font-mono text-xs font-medium mt-0.5 flex items-center gap-1.5"><FileBadge size={12} className="text-muted-foreground" />{selectedBroker.LHeadRera}</dd>
                          </div>
                        )}
                        {selectedBroker.LHeadPaymentTerms && (
                          <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Payment Terms</dt>
                            <dd className="text-foreground font-medium mt-0.5">{selectedBroker.LHeadPaymentTerms}</dd>
                          </div>
                        )}
                      </dl>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Default rate (preview)</label>
                        <input readOnly value={`${brokerageTierDefault}% (< 1 Cr → 2%, ≥ 1 Cr → 1%)`}
                          className={`${inputCls} bg-muted/30 text-muted-foreground`} />
                      </div>
                      <div>
                        <label className={labelCls}>Commission override % (only if this deal needs a custom rate)</label>
                        <input type="number" step="0.01" min="0" max="100" value={form.BrokerageRatePercent}
                          onChange={(e) => setForm((f) => ({ ...f, BrokerageRatePercent: e.target.value }))}
                          placeholder={String(brokerageTierDefault)} className={inputCls} />
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Commission is paid out one milestone at a time, following the same schedule as the customer's own payments — unlocking as each milestone is paid.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && applicationId && (
            <ParkingSelectionStep
              applicationId={applicationId}
              projectId={form.ProjectId}
              blockId={form.BlockId}
              computedTotal={computedTotal}
              canEdit={canEditUnitSelection}
              wizardAppStatus={wizardAppStatus}
            />
          )}

          {step === 3 && applicationId && (
            <BankDetailsStep
              applicationId={applicationId}
              applicantName={selectedCustomer?.CustomerName || ""}
              applicantAddress={[selectedCustomer?.CurrentAddress, selectedCustomer?.CurrentCity, selectedCustomer?.CurrentState, selectedCustomer?.CurrentPincode].filter(Boolean).join(", ")}
              onRegisterSave={(fn) => { saveBankDetailsRef.current = fn; }}
            />
          )}

          {step === 4 && applicationId && (
            <CoApplicantStep
              applicationId={applicationId}
              applicantName={selectedCustomer?.CustomerName || ""}
              applicantAddress={selectedCustomer?.CurrentAddress || ""}
              applicantCity={selectedCustomer?.CurrentCity || ""}
              applicantState={selectedCustomer?.CurrentState || ""}
              applicantPincode={selectedCustomer?.CurrentPincode || ""}
            />
          )}

          {step === 5 && applicationId && (
            <AttachmentsStep applicationId={applicationId} />
          )}

          {step === 6 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><User size={11} /> Assigned Sales Person</p>
                  <p className="font-medium text-foreground">{currentUser?.name || "—"} (you)</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><User size={11} /> Assigned By</p>
                  <p className="font-medium text-foreground">{currentUser?.name || "—"} (you)</p>
                </div>
              </div>

              {/* Unit, price, parking — one brief, well-derived summary
                  pulling together everything decided across the earlier
                  steps, so nothing has to be re-checked tab by tab. */}
              {selectedUnit && (
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-foreground flex items-center gap-1.5"><Building2 size={12} className="text-primary" /> Unit & Price</p>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{selectedUnit.UnitName} · {selectedUnit.UnitType || "—"} · {selectedUnit.AreaSqFt ? `${selectedUnit.AreaSqFt} sqft` : "—"}</span>
                    <span className="font-semibold text-foreground shrink-0">{computedTotal ? `₹${computedTotal.toLocaleString("en-IN")}` : "—"}</span>
                  </div>
                  {detailParkingTotal > 0 && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Parking ({(detailParkingAllotments as any[]).length})</span>
                      <span className="font-semibold text-foreground shrink-0">₹{detailParkingTotal.toLocaleString("en-IN")}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-1 mt-1">
                    <span className="text-muted-foreground">Grand Total</span>
                    <span className="font-semibold text-primary">₹{(computedTotal + detailParkingTotal).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              )}

              {/* Payment plan breakdown — identical math to the Step 1
                  preview (Booking is the plan's own fixed ₹, everything
                  after it splits 100% of Total - Booking). */}
              {selectedPaymentPlan && selectedPlanMilestones.length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-foreground">{selectedPaymentPlan.PlanName} — Payment Breakdown</p>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Booking</span>
                    <span className="font-semibold text-foreground">₹{selectedPlanBookingAmount.toLocaleString("en-IN")}</span>
                  </div>
                  {selectedPlanMilestones.slice(1).map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-muted-foreground">
                      <span className="truncate pr-2">{m.name} <span className="text-[10px]">({m.pct}%)</span></span>
                      <span className="font-semibold text-foreground shrink-0">
                        {computedTotal ? `₹${Math.round((selectedPlanRemainder * m.pct) / 100).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Payment Details — the actual token capture. These columns
                  already existed on CrmApplication and were already read by
                  the auto-sync/retry paths, but nothing in the wizard ever
                  wrote them until now. Kept here on Details (not a new step,
                  not folded into Bank/KYC) since it belongs with the final
                  review right before Submit, once Project/Unit is known and
                  the bank picker can be project-scoped. */}
              <div className="rounded-lg border border-border p-3 space-y-2.5">
                <label className="text-xs font-semibold text-foreground block">Payment Details</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Token Type</label>
                    <input type="text" value="Amount" readOnly disabled
                      title="Fixed — the Booking Amount is always a ₹ figure set by the Payment Plan, never a % staff pick here"
                      className={`${inputCls} bg-muted/30 text-muted-foreground cursor-not-allowed`} />
                  </div>
                  <div>
                    <label className={labelCls}>Token (Booking) Amount (₹)</label>
                    <input type="number" value={form.TokenValue}
                      onChange={(e) => setForm((f) => ({ ...f, TokenValue: e.target.value }))}
                      placeholder={selectedPlanBookingAmount ? String(selectedPlanBookingAmount) : undefined}
                      className={inputCls} />
                    {selectedPlanBookingAmount > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Defaults to the plan's fixed ₹{selectedPlanBookingAmount.toLocaleString("en-IN")} — change this only if the customer actually paid a different amount; anything over the fixed figure is auto-parked to On Account, not lost.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Payment Mode</label>
                    <select value={form.PaymentMode} onChange={(e) => setForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                      className={inputCls}>
                      <option value="">Select</option>
                      {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>
                      Deposited To (Company Bank){projectBanks.length > 0 ? " — scoped to this project" : ""}{bankOptions.length > 0 ? " *" : ""}
                    </label>
                    <select value={form.DepositBankId} onChange={(e) => setForm((f) => ({ ...f, DepositBankId: e.target.value }))}
                      className={inputCls}>
                      <option value="">— Select company bank —</option>
                      {(bankOptions as any[]).map((b: any) => (
                        <option key={b.BId} value={String(b.BId)}>{b.BName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>Notes / Remarks</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={4} className={`${inputCls} resize-none`} />
              </div>
              <p className="text-xs text-muted-foreground">
                This application is <span className="font-medium text-foreground">Pending</span> admin approval.
                Only an admin/super admin can approve or reject it. Approval creates the Booking as Pending — the
                payment plan, booking amount and payment itself are all handled on the Booking page from there.
              </p>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-3 border-t border-border">
            <button
              onClick={() => step > 1 && setStep(step - 1)}
              disabled={step === 1}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 flex items-center gap-1">
              <ChevronLeft size={14} /> Back
            </button>
            <div className="flex gap-2">
              <button onClick={() => { setDialogOpen(false); resetWizard(); }}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
              {step === 1 && (
                <button onClick={handleCreateAndNext} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-1">
                  {saving ? "Saving..." : "Next"} <ChevronRight size={14} />
                </button>
              )}
              {step === 2 && (
                <button onClick={() => advanceStep(3)}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center gap-1">
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 3 && (
                <button onClick={handleBankDetailsNext} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-1">
                  {saving ? "Saving..." : "Next"} <ChevronRight size={14} />
                </button>
              )}
              {step === 4 && (
                <button onClick={() => advanceStep(5)}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center gap-1">
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 5 && (
                <button onClick={() => advanceStep(6)}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center gap-1">
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 6 && (
                <button onClick={handleFinalSave} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  {saving ? "Submitting..." : "Submit Application"}
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Generate Booking Invoice ── */}
      <Dialog open={!!invoiceRow} onOpenChange={(o) => { if (!o) { setInvoiceRow(null); setInvoiceForm({ Amount: "", InvoiceType: "Booking", InvoiceDate: "", Description: "" }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Generate Booking Invoice</DialogTitle></DialogHeader>
          {invoiceRow && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                Every real payment already generates its own invoice automatically — use this only for a genuine ad-hoc charge that isn't tied to a milestone. Amount below is pre-filled from the booking's actual outstanding balance.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                <div className="flex justify-between items-center px-3 py-2">
                  <span className="text-xs text-muted-foreground">Booking</span>
                  <span className="text-sm font-medium font-mono">{invoiceRow.BookingNo}</span>
                </div>
                <div className="flex justify-between items-center px-3 py-2">
                  <span className="text-xs text-muted-foreground">Applicant</span>
                  <span className="text-sm font-medium">{invoiceRow.ApplicantName}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Amount *</label>
                  <input type="number" value={invoiceForm.Amount} disabled={invoiceLoading}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, Amount: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background disabled:opacity-50"
                    placeholder={invoiceLoading ? "Loading outstanding balance..." : ""} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Invoice Type</label>
                  <select value={invoiceForm.InvoiceType} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceType: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="Booking">Booking</option>
                    <option value="Milestone">Milestone</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Invoice Date</label>
                  <input type="date" value={invoiceForm.InvoiceDate} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Description</label>
                <textarea value={invoiceForm.Description} onChange={(e) => setInvoiceForm((f) => ({ ...f, Description: e.target.value }))}
                  rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setInvoiceRow(null); setInvoiceForm({ Amount: "", InvoiceType: "Booking", InvoiceDate: "", Description: "" }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleGenerateInvoice} disabled={invoiceSaving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {invoiceSaving ? "Generating..." : "Generate Invoice"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Application detail — opened by clicking any row, in every stage
          tab (In Process/Converted/Not Converted). Read-only summary; the
          actions that actually change something (Resume, Approve/Reject,
          View Booking, Generate Invoice) stay on the row itself, not here. ── */}
      <Dialog open={!!viewingAppId} onOpenChange={(o) => { if (!o) setViewingAppId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              {viewingAppDetail ? (
                <>
                  <span className="font-mono text-primary">{viewingAppDetail.application.ApplicationNo}</span>
                  <span>— {viewingAppDetail.application.ApplicantName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[viewingAppDetail.application.Status] || ""}`}>
                    {viewingAppDetail.application.Status}
                  </span>
                </>
              ) : "Application Details"}
            </DialogTitle>
          </DialogHeader>
          {!viewingAppDetail ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (() => {
            const a = viewingAppDetail.application;
            const booking = (viewingAppDetail.bookings || [])[0];
            // Unit price — same Area × Rate math as the wizard's own
            // computedTotal, computed here straight off the fetched
            // application/unit fields rather than wizard state (this dialog
            // is a separate read-only view, never inside the wizard).
            const unitArea = Number(a.UnitAreaSqFt) || 0;
            const unitRate = Number(a.RatePerSqFt) || 0;
            const unitTotal = unitArea && unitRate ? Math.round(unitArea * unitRate) : 0;
            const parkingRows = viewingAppParking as any[];
            const parkingTotal = parkingRows.reduce((s, p) => s + (Number(p.TotalAmount) || 0), 0);
            // Same plan lookup + milestone math as the wizard's step-1 plan
            // preview (selectedPaymentPlan/selectedPlanMilestones) — reused
            // here against the already-cached payment-plans list instead of
            // a second fetch, keyed off this application's own PaymentPlanId.
            const plan = (paymentPlans as any[]).find((p: any) => String(p.Id) === String(a.PaymentPlanId)) || null;
            const planMilestones = parseMilestones(plan?.MilestonesJson);
            const planBookingAmount = Number(plan?.BookingAmount || 0);
            const planRemainder = Math.max(0, unitTotal - planBookingAmount);
            const grandTotal = unitTotal + parkingTotal;
            return (
              <div className="space-y-4">
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><User size={14} className="text-primary" /> Applicant</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex items-center gap-1.5"><Phone size={12} className="text-muted-foreground" /> {a.Mobile}{a.AltMobile ? ` / ${a.AltMobile}` : ""}</div>
                    <div className="flex items-center gap-1.5"><Mail size={12} className="text-muted-foreground" /> {a.Email || "—"}</div>
                    <div className="flex items-center gap-1.5"><IdCard size={12} className="text-muted-foreground" /> PAN: {a.PanNo || "—"}</div>
                    <div className="flex items-center gap-1.5"><FileBadge size={12} className="text-muted-foreground" /> {a.CustomerNo || "—"}</div>
                    <div className="col-span-2 flex items-start gap-1.5"><MapPin size={12} className="text-muted-foreground mt-0.5" />
                      {[a.CustomerAddress, a.CustomerCity, a.CustomerState, a.CustomerPincode].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                  {(viewingAppCoApplicants as any[]).length > 0 && (
                    <div className="pt-2 border-t border-border space-y-1.5">
                      {(viewingAppCoApplicants as any[]).map((co: any) => (
                        <div key={co.Id} className="flex items-center gap-1.5 text-xs">
                          <Users2 size={12} className="text-muted-foreground shrink-0" />
                          <span className="font-medium">{co.Name}</span>
                          {co.Relation && <span className="text-muted-foreground">({co.Relation})</span>}
                          {co.Mobile && <span className="text-muted-foreground">— {co.Mobile}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><Building2 size={14} className="text-primary" /> Project & Unit</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div><span className="text-muted-foreground">Company:</span> {a.CompanyName || "—"}</div>
                    <div><span className="text-muted-foreground">Project:</span> {a.ProjectMasterName || a.InterestedProject || "—"}</div>
                    <div><span className="text-muted-foreground">Preferred Unit:</span> {a.PreferredUnitName || a.InterestedUnit || "—"}</div>
                    <div><span className="text-muted-foreground">Type:</span> {
                      [a.PropertyType, a.BhkPreference].filter(Boolean).join(" · ")
                      || [a.UnitTypeFromMaster, a.UnitAreaSqFt ? `${a.UnitAreaSqFt} sqft` : null].filter(Boolean).join(" · ")
                      || "—"
                    }</div>
                  </div>
                  {!!a.UnitUnavailableForBooking && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 pt-2 border-t border-border">
                      <XCircle size={12} /> This unit is currently booked or held by a different application — a booking can't be created until it's re-picked.
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><IndianRupee size={14} className="text-primary" /> Financials</h3>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Unit Price</span>
                    <span className="font-medium text-foreground">
                      {unitArea && unitRate
                        ? `${unitArea} sqft × ₹${unitRate.toLocaleString("en-IN")}/sqft = ₹${unitTotal.toLocaleString("en-IN")}`
                        : "—"}
                    </span>
                  </div>

                  {parkingRows.length > 0 && (
                    <div className="pt-2 border-t border-border space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Parking ({parkingRows.length})</span>
                        <span className="font-medium text-foreground">₹{parkingTotal.toLocaleString("en-IN")}</span>
                      </div>
                      {parkingRows.map((p: any) => (
                        <div key={p.Id} className="flex items-center justify-between text-[11px] text-muted-foreground pl-2">
                          <span>{p.CurrentParkingType}{p.SlotNo ? ` — Slot ${p.SlotNo}` : ` × ${p.Quantity}`}{p.Kind === "Hold" ? " (Held)" : ""}</span>
                          <span>₹{Number(p.TotalAmount).toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2 border-t border-border space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Payment Plan</span>
                      <span className="font-medium text-foreground">{a.PaymentPlanName || "—"}</span>
                    </div>
                    {plan && planMilestones.length > 0 ? (
                      <>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-2">
                          <span>Booking</span>
                          <span className="font-medium text-foreground">₹{planBookingAmount.toLocaleString("en-IN")}</span>
                        </div>
                        {planMilestones.slice(1).map((m, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] text-muted-foreground pl-2">
                            <span className="truncate pr-2">{m.name} <span className="text-[10px]">({m.pct}%)</span></span>
                            <span className="font-medium text-foreground shrink-0">
                              {unitTotal ? `₹${Math.round((planRemainder * m.pct) / 100).toLocaleString("en-IN")}` : "—"}
                            </span>
                          </div>
                        ))}
                      </>
                    ) : (
                      <p className="text-[11px] text-muted-foreground pl-2">{a.PaymentPlanName ? "No milestone breakdown set on this plan." : "Set once a Payment Plan is picked."}</p>
                    )}
                  </div>

                  {(unitTotal > 0 || parkingTotal > 0) && (
                    <div className="pt-2 border-t border-border flex items-center justify-between text-xs font-semibold">
                      <span>Total</span>
                      <span className="text-primary">₹{grandTotal.toLocaleString("en-IN")}</span>
                    </div>
                  )}

                  {a.BrokerName && (
                    <div className="pt-2 border-t border-border text-xs">
                      <span className="text-muted-foreground">Broker:</span> {a.BrokerName} {a.BrokerageRatePercent != null && `(${a.BrokerageRatePercent}%)`}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><Briefcase size={14} className="text-primary" /> Source & Assignment</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div><span className="text-muted-foreground">Source:</span> {a.Source || "—"}</div>
                    <div><span className="text-muted-foreground">Assigned To:</span> {a.AssigneeName || "—"}</div>
                    <div className="col-span-2 text-muted-foreground">
                      {[a.PlatformName, a.CampaignName, a.AdName].filter(Boolean).join(" › ") || a.ChannelPartnerName || ""}
                    </div>
                  </div>
                </div>

                {booking && (
                  <div className="rounded-xl border border-border p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5"><FileText size={14} className="text-primary" /> Linked Booking</h3>
                      <button onClick={() => { setViewingAppId(null); navigate(`/crm/bookings?applicationId=${a.Id}`); }}
                        className="text-xs text-primary hover:underline flex items-center gap-1">
                        View Booking <ChevronRight size={12} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div><span className="text-muted-foreground">Booking No:</span> {booking.BookingNo}</div>
                      <div><span className="text-muted-foreground">Status:</span> {booking.Status}</div>
                      <div><span className="text-muted-foreground">Unit:</span> {[booking.ProjectName, booking.UnitNo].filter(Boolean).join(" · ") || "—"}</div>
                      <div><span className="text-muted-foreground">Value:</span> {booking.TotalValue ? `₹${Number(booking.TotalValue).toLocaleString("en-IN")}` : "—"}</div>
                    </div>
                  </div>
                )}

                {a.Notes && (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <h3 className="text-sm font-semibold">Notes</h3>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{a.Notes}</p>
                  </div>
                )}

                {(viewingAppDetail.statusLog || []).length > 0 && (
                  <div className="rounded-xl border border-border p-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><History size={14} className="text-primary" /> Status History</h3>
                    <div className="space-y-1.5">
                      {viewingAppDetail.statusLog.map((s: any) => (
                        <div key={s.Id} className="flex items-center justify-between text-xs">
                          <span>
                            <span className="font-medium">{s.FromStatus ? `${s.FromStatus} → ${s.ToStatus}` : s.ToStatus}</span>
                            {s.ActorName && <span className="text-muted-foreground"> by {s.ActorName}</span>}
                          </span>
                          <span className="text-muted-foreground">{s.CreatedAt ? String(s.CreatedAt).slice(0, 16).replace("T", " ") : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setViewingAppId(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
              Close
            </button>
            {viewingAppDetail && canCancelApplication(viewingAppDetail.application) && (
              <button
                onClick={() => { setCancellingApp(viewingAppDetail.application); setCancelRemarks(""); }}
                className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg font-medium hover:bg-red-50"
              >
                Cancel Application
              </button>
            )}
            {viewingAppDetail && isResumeEditable(viewingAppDetail.application) && (
              <button
                onClick={() => { const id = viewingAppDetail.application.Id; setViewingAppId(null); loadApplicationIntoWizard(id); }}
                disabled={loadingApplication}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40"
              >
                {loadingApplication ? "Loading..." : "Resume"}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel is one-way (no "un-cancel" on the backend) — always confirm
          before firing it, and explain what actually happens (hold release)
          so staff aren't surprised the unit shows as available again right
          after. */}
      <Dialog open={!!cancellingApp} onOpenChange={(o) => { if (!o) { setCancellingApp(null); setCancelRemarks(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Cancel Application?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-foreground">{cancellingApp?.ApplicationNo}</span> for{" "}
              <span className="font-medium text-foreground">{cancellingApp?.ApplicantName}</span> will be moved to Cancelled.
              {(cancellingApp?.PreferredUnitName || cancellingApp?.InterestedUnit) && (
                " Any hold on the picked unit — and any parking slot tied to it — is released immediately, so it's available for another application right away."
              )}
              {" "}This can't be undone; file a new application to reapply.
            </p>
            <div>
              <label className={labelCls}>Remarks (optional)</label>
              <textarea
                value={cancelRemarks}
                onChange={(e) => setCancelRemarks(e.target.value)}
                rows={2}
                className={`${inputCls} resize-none`}
                placeholder="e.g. Applied by mistake, customer changed their mind..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setCancellingApp(null); setCancelRemarks(""); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted"
            >
              Keep Application
            </button>
            <button
              onClick={handleCancelApplication}
              disabled={cancelling}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40"
            >
              {cancelling ? "Cancelling..." : "Cancel Application"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

// ── Step 3: Bank / KYC / Nominee — identity & bank details only ───────────────
// Identity fields the Customer master already captures at intake — when the
// KYC form loads with no bank-detail row saved yet, the backend pre-fills
// these from dbo.CrmCustomer and flags the response _prefilledFrom:
// "customer". Those (and only those) fields render locked/view-only below,
// with an explicit "Edit" toggle to recheck and confirm against the
// customer — never silently editable as if freshly typed. Once this form is
// saved once, its own CrmCustomerBankDetail row exists going forward, so
// later loads return real saved data (no _prefilledFrom flag) and every
// field is a normal, already-unlocked input.
const KYC_PREFILL_KEYS = ["PanNo", "AccountHolderName", "AadhaarNo", "Occupation", "AnnualIncome"] as const;

const BankDetailsStep: React.FC<{
  applicationId: number;
  applicantName?: string;
  applicantAddress?: string;
  onRegisterSave?: (fn: null | (() => Promise<void>)) => void;
}> = ({ applicationId, applicantName, applicantAddress, onRegisterSave }) => {
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankLoaded, setBankLoaded] = useState(false);
  // Which of KYC_PREFILL_KEYS are currently locked (auto-fetched from the
  // customer record, not yet reviewed/confirmed by staff this time around).
  const [kycLocked, setKycLocked] = useState<Set<string>>(new Set());
  // "Same as applicant's address" for the Nominee — a convenience toggle,
  // not a customer-data prefill lock like kycLocked above. Checking it
  // copies the applicant's current address in; unchecking hands the field
  // back for free editing. Defaults on if a saved NomineeAddress already
  // matches the applicant's address (e.g. re-opening a previously saved form).
  const [nomineeSameAsApplicant, setNomineeSameAsApplicant] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBankLoaded(false);
    setBank({ ...EMPTY_BANK });
    setKycLocked(new Set());
    setNomineeSameAsApplicant(false);
    fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return;
        setBank({
          BankName: d.BankName || "", BranchName: d.BranchName || "", AccountNo: d.AccountNo || "",
          IfscCode: d.IfscCode || "", AccountHolderName: d.AccountHolderName || "",
          NomineeName: d.NomineeName || "", NomineeRelation: d.NomineeRelation || "",
          NomineeDob: d.NomineeDob ? String(d.NomineeDob).slice(0, 10) : "",
          NomineeContact: d.NomineeContact || "", NomineeAddress: d.NomineeAddress || "",
          PanNo: d.PanNo || "", AadhaarNo: d.AadhaarNo || "",
          Occupation: d.Occupation || "", AnnualIncome: d.AnnualIncome != null ? String(d.AnnualIncome) : "",
        });
        if (d._prefilledFrom === "customer") {
          const locked = new Set<string>();
          KYC_PREFILL_KEYS.forEach((k) => { if (d[k] !== null && d[k] !== undefined && String(d[k]).trim() !== "") locked.add(k); });
          setKycLocked(locked);
        }
        if (applicantAddress && d.NomineeAddress && d.NomineeAddress.trim() === applicantAddress.trim()) {
          setNomineeSameAsApplicant(true);
        }
      })
      .finally(() => { if (!cancelled) setBankLoaded(true); });
    return () => { cancelled = true; };
  }, [applicationId]);

  // While the "same as applicant" checkbox is on, keep NomineeAddress in
  // step if the applicant's address itself changes (e.g. a different
  // customer gets selected before this application is first saved).
  useEffect(() => {
    if (nomineeSameAsApplicant) {
      setBank((b) => (b.NomineeAddress === (applicantAddress || "") ? b : { ...b, NomineeAddress: applicantAddress || "" }));
    }
  }, [nomineeSameAsApplicant, applicantAddress]);

  const saveBank = useCallback(async (silent = false) => {
    setBankSaving(true);
    try {
      const res = await fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bank),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      if (!silent) toast.success("Bank/KYC details saved");
    } catch (e: any) {
      toast.error(e.message);
      throw e;
    } finally {
      setBankSaving(false);
    }
  }, [applicationId, bank]);

  useEffect(() => {
    onRegisterSave?.(() => saveBank(true));
    return () => onRegisterSave?.(null);
  }, [onRegisterSave, saveBank]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">KYC / Bank Details</label>
          <button onClick={() => saveBank()} disabled={bankSaving || !bankLoaded}
            className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40">
            {bankSaving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["BankName", "Bank Name"], ["BranchName", "Branch"], ["AccountNo", "Account No"], ["IfscCode", "IFSC Code"],
            ["AccountHolderName", "Account Holder Name"], ["PanNo", "PAN No"], ["AadhaarNo", "Aadhaar No"],
            ["Occupation", "Occupation"], ["AnnualIncome", "Annual Income"],
          ].map(([key, label]) => (
            <div key={key}>
              <label className={labelCls}>{label}</label>
              {kycLocked.has(key) ? (
                <div className="flex items-center justify-between gap-2 bg-muted/30 rounded px-2 py-1.5 border border-border">
                  <span className="text-sm text-foreground truncate">{(bank as any)[key] || "—"} <span className="text-xs text-muted-foreground">(auto-fetched from customer)</span></span>
                  <button type="button" onClick={() => setKycLocked((s) => { const next = new Set(s); next.delete(key); return next; })}
                    className="text-xs text-primary hover:underline shrink-0">
                    Edit
                  </button>
                </div>
              ) : (
                <input value={(bank as any)[key]} onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))} className={inputCls} />
              )}
            </div>
          ))}
        </div>
        <div className="pt-2 border-t border-border/60">
          <p className="text-xs font-medium text-foreground mb-2">Nominee</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["NomineeName", "Name"], ["NomineeContact", "Contact"],
            ].map(([key, label]) => (
              <div key={key}>
                <label className={labelCls}>{label}</label>
                <input value={(bank as any)[key]} onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))} className={inputCls} />
              </div>
            ))}
            <div>
              <label className={labelCls}>Relation</label>
              <select value={bank.NomineeRelation} onChange={(e) => setBank((b) => ({ ...b, NomineeRelation: e.target.value }))} className={inputCls}>
                <option value="">Select</option>
                <option value="Spouse">Spouse</option>
                <option value="Son">Son</option>
                <option value="Daughter">Daughter</option>
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Brother">Brother</option>
                <option value="Sister">Sister</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelCls + " mb-0"}>Address</label>
                {applicantAddress && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={nomineeSameAsApplicant}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setNomineeSameAsApplicant(checked);
                        if (checked) setBank((b) => ({ ...b, NomineeAddress: applicantAddress }));
                      }}
                      className="rounded border-border" />
                    Same as {applicantName || "applicant"}'s address
                  </label>
                )}
              </div>
              <input value={bank.NomineeAddress} readOnly={nomineeSameAsApplicant}
                onChange={(e) => setBank((b) => ({ ...b, NomineeAddress: e.target.value }))}
                className={inputCls + (nomineeSameAsApplicant ? " bg-muted/30 text-muted-foreground cursor-not-allowed" : "")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Step 3: Attachments — document upload + parking multi-select ─────────────
// ── Step 2: Parking Selection ──────────────────────────────────────────────────
const ParkingSelectionStep: React.FC<{
  applicationId: number; projectId: string; blockId: string;
  computedTotal: number;
  // Same Draft/Pending gate as canEditUnitSelection on the parent — parking
  // picked here is still just an Application-stage hold (see crmParking.js
  // POST /standalone), converted into a real CrmParkingAllotment only once
  // the Application's Booking exists, so it has to stop moving at the exact
  // same point the unit does: once Approved, a Booking either already exists
  // or is expected imminently, and the pick can't change out from under it.
  canEdit: boolean;
  wizardAppStatus: string | null;
}> = ({ applicationId, projectId, blockId, computedTotal, canEdit, wizardAppStatus }) => {
  const { data: allotments = [], refetch: refetchParking } = useQuery({
    queryKey: ["crm-app-parking", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
  });

  // Truly-available parking, computed server-side against every allotment
  // and hold system-wide (not just this application's own picks) — see
  // crmParking.js GET /available. Refetched alongside allotments so a slot
  // this step itself just took disappears from "available" immediately too.
  const { data: parkingAvailability, refetch: refetchAvailable } = useQuery({
    queryKey: ["crm-parking-available", projectId, blockId],
    queryFn: async () => {
      if (!projectId) return { rates: [], unratedTypesWithInventory: [] };
      const params = new URLSearchParams({ projectId });
      if (blockId) params.set("blockId", blockId);
      const r = await fetchWithAuth(`${PARKING_API}/available?${params}`);
      return r.ok ? r.json() : { rates: [], unratedTypesWithInventory: [] };
    },
    enabled: !!projectId,
  });
  const availableRates = parkingAvailability?.rates || [];
  // Slot inventory that exists (Parking Slot Master) but has no matching
  // rate (Parking Rate Master) — distinct from "no parking at all", which
  // is what the old flat "no parking rates configured" message conflated.
  const unratedTypesWithInventory: string[] = parkingAvailability?.unratedTypesWithInventory || [];

  const refetchAll = () => { refetchParking(); refetchAvailable(); };

  const [selectedType, setSelectedType] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [adding, setAdding] = useState(false);

  // Reset the slot/quantity pick (not the type) whenever the chosen type's
  // own available list changes under it — e.g. someone else just took the
  // one slot this staff member had highlighted.
  const currentType = (availableRates as any[]).find((r: any) => r.ParkingType === selectedType) || null;
  useEffect(() => { setSelectedSlotId(""); }, [selectedType]);

  const handleAdd = async () => {
    if (!currentType) return;
    if (!currentType.HasSlots) { toast.error("No slots available for this parking type"); return; }
    if (!selectedSlotId) { toast.error("Select a slot"); return; }
    setAdding(true);
    try {
      const body: any = {
        ApplicationId: applicationId, ParkingMasterId: currentType.ParkingMasterId,
        ParkingSlotId: parseInt(selectedSlotId), Quantity: 1,
      };
      const res = await fetchWithAuth(`${PARKING_API}/standalone`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to add ${currentType.ParkingType}`);
      toast.success(`${currentType.ParkingType} added — ₹${Number(data.TotalAmount).toLocaleString("en-IN")}`);
      setSelectedType(""); setSelectedSlotId("");
      refetchAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveParking = async (a: any) => {
    try {
      // A slot pick is only a hold until the Booking is created (see
      // crmParking.js POST /standalone) — releasing it goes through the
      // hold-release route, not the allotment DELETE, since there's no
      // CrmParkingAllotment row yet to delete.
      const url = a.Kind === "Hold" ? `${PARKING_API}/hold/${a.Id}` : `${PARKING_API}/${a.Id}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchAll();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const parkingTotal = (allotments as any[]).reduce((s, a) => s + (Number(a.TotalAmount) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Auto-filled charges summary — one brief line, same compact style
          as the Unit price preview on Step 1, instead of a 3-cell grid. */}
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
        <IndianRupee size={11} className="text-primary shrink-0" />
        Unit ₹{computedTotal.toLocaleString("en-IN")}
        {parkingTotal > 0 && ` + Parking ₹${parkingTotal.toLocaleString("en-IN")}`}
        {" = "}
        <span className="font-semibold text-foreground">Grand Total ₹{(computedTotal + parkingTotal).toLocaleString("en-IN")}</span>
      </div>

      {/* Already-added allotments */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><ParkingSquare size={13} /> Selected Parking</label>
          {!canEdit && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              <Lock size={11} /> Locked ({wizardAppStatus})
            </span>
          )}
        </div>
        {(allotments as any[]).length > 0 ? (
          <div className="space-y-1.5">
            {(allotments as any[]).map((a: any) => (
              <div key={`${a.Kind}-${a.Id}`} className="flex items-center justify-between text-xs rounded-md bg-muted/30 px-2.5 py-1.5">
                <span className="flex items-center gap-1.5">
                  {a.CurrentParkingType} {a.SlotNo ? `— Slot ${a.SlotNo}` : `× ${a.Quantity}`} · ₹{Number(a.TotalAmount).toLocaleString("en-IN")}
                  {a.Kind === "Hold" && (
                    <span title="Reserved — becomes a permanent allotment once this application's booking is created"
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-600">
                      Held
                    </span>
                  )}
                </span>
                {canEdit && (
                  <button onClick={() => handleRemoveParking(a)} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No parking selected yet — optional.</p>
        )}
      </div>

      {/* Add parking — pick a type, then (if it has fixed slots) pick a slot */}
      {!canEdit ? null : !projectId ? (
        <p className="text-xs text-muted-foreground">Select a project in Step 1 to choose parking.</p>
      ) : (availableRates as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {unratedTypesWithInventory.length > 0
            ? `${unratedTypesWithInventory.join(", ")} parking slots exist for this project, but no rate is configured — add one in Parking Rate Master.`
            : "No parking rates configured for this project."}
        </p>
      ) : (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Parking Type</label>
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">— Select a parking type —</option>
              {(availableRates as any[]).map((r: any) => {
                // No ParkingSlot rows entered for this type at all yet —
                // Ops hasn't set up inventory in Parking Slot Master.
                // Quantity-only selling is no longer offered as a fallback;
                // this type is simply unavailable until slots exist.
                const noneInBlock = r.HasSlots && r.AvailableSlots.length === 0;
                // "Sold out" only when the backend confirms zero slots of
                // this type are free ANYWHERE in the project (see
                // SoldOutProjectWide in crmParking.js GET /available).
                // Basement/Covered-style parking is often reserved
                // per-block, so a block-scoped zero doesn't necessarily
                // mean no inventory exists — it may just belong to another
                // block/tower.
                const soldOutEverywhere = noneInBlock && r.SoldOutProjectWide;
                const availableElsewhere = noneInBlock && !r.SoldOutProjectWide;
                const disabled = r.NoInventory || noneInBlock;
                return (
                  <option key={r.ParkingType} value={r.ParkingType} disabled={disabled}>
                    {r.ParkingType} — ₹{Number(r.Charge).toLocaleString("en-IN")} each
                    {r.HasSlots ? ` (${r.AvailableSlots.length} available)` : ""}
                    {r.NoInventory ? " — Not available (no slots set up yet)" : ""}
                    {soldOutEverywhere ? " — Sold out" : ""}
                    {availableElsewhere ? ` — None in this block (${r.FreeCountProjectWide} free in other blocks)` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          {currentType && currentType.HasSlots && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Available Slot</label>
              <select value={selectedSlotId} onChange={(e) => setSelectedSlotId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Select a slot —</option>
                {currentType.AvailableSlots.map((s: any) => (
                  <option key={s.Id} value={String(s.Id)}>Slot {s.SlotNo}</option>
                ))}
              </select>
            </div>
          )}

          {/* Defensive only — the dropdown disables this option, so a
              no-inventory type shouldn't normally reach here. */}
          {currentType && !currentType.HasSlots && (
            <p className="text-xs text-muted-foreground">
              No slots have been set up for {currentType.ParkingType} parking yet — ask an admin to add them in Parking Slot Master.
            </p>
          )}

          {currentType && (
            <button onClick={handleAdd} disabled={adding || !currentType.HasSlots || !selectedSlotId}
              className="w-full text-xs px-3 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-40">
              {adding ? "Adding..." : `Add ${currentType.ParkingType}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Step 4: Co-Applicant(s) ─────────────────────────────────────────────────────
// Captured directly against the Application (dbo.CrmCoApplicant, ApplicationId
// set now, BookingId backfilled later by crmEntityCreation.js) rather than as
// a single flat name/relation/mobile on CrmCustomer as before — a customer can
// have a different set of co-applicants on each of their Applications, and a
// deal can have more than one. See crmCoApplicant.js's /application/:id routes.
const emptyCoApplicant = () => ({
  Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "",
  DateOfBirth: "", Gender: "", Occupation: "", AnnualIncome: "",
  Address: "", City: "", State: "", Pincode: "", Notes: "",
});

const CoApplicantStep: React.FC<{
  applicationId: number;
  applicantName?: string;
  applicantAddress?: string;
  applicantCity?: string;
  applicantState?: string;
  applicantPincode?: string;
}> = ({ applicationId, applicantName, applicantAddress, applicantCity, applicantState, applicantPincode }) => {
  const { data: coApplicants = [], refetch } = useQuery({
    queryKey: ["crm-app-co-applicants-edit", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${CO_APPLICANT_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
  });

  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<any>(emptyCoApplicant());
  const [saving, setSaving] = useState(false);
  // Clicking a co-applicant's row (anywhere but Edit/Delete) opens a
  // read-only details popup — the row itself only ever shows Name/Relation/
  // Mobile, so this is the only way to see PAN, Aadhaar, DOB, address, etc.
  // without dropping into edit mode.
  const [viewingCoApplicant, setViewingCoApplicant] = useState<any | null>(null);
  // "Same as applicant's address" — same convenience toggle as the Nominee
  // section: checking it copies the applicant's current Address/City/State/
  // Pincode in and locks those fields; unchecking hands them back for free
  // editing. Defaults on if a saved co-applicant's address already matches
  // the applicant's (e.g. re-opening a previously saved entry).
  const [sameAsApplicant, setSameAsApplicant] = useState(false);

  const startAdd = () => { setDraft(emptyCoApplicant()); setEditingId("new"); setSameAsApplicant(false); };
  const startEdit = (co: any) => {
    setDraft({
      Name: co.Name || "", Relation: co.Relation || "", Mobile: co.Mobile || "",
      Email: co.Email || "", PanNo: co.PanNo || "", AadhaarNo: co.AadhaarNo || "",
      DateOfBirth: co.DateOfBirth ? String(co.DateOfBirth).slice(0, 10) : "",
      Gender: co.Gender || "", Occupation: co.Occupation || "",
      AnnualIncome: co.AnnualIncome != null ? String(co.AnnualIncome) : "",
      Address: co.Address || "", City: co.City || "", State: co.State || "",
      Pincode: co.Pincode || "", Notes: co.Notes || "",
    });
    setEditingId(co.Id);
    setSameAsApplicant(
      !!applicantAddress && (co.Address || "").trim() === applicantAddress.trim() &&
      (co.City || "").trim() === (applicantCity || "").trim() &&
      (co.State || "").trim() === (applicantState || "").trim() &&
      (co.Pincode || "").trim() === (applicantPincode || "").trim()
    );
  };
  const cancelEdit = () => { setEditingId(null); setDraft(emptyCoApplicant()); setSameAsApplicant(false); };

  // While the checkbox is on, keep the draft's address fields in step if
  // the applicant's own address changes mid-edit.
  useEffect(() => {
    if (sameAsApplicant) {
      setDraft((d: any) => ({
        ...d,
        Address: applicantAddress || "", City: applicantCity || "",
        State: applicantState || "", Pincode: applicantPincode || "",
      }));
    }
  }, [sameAsApplicant, applicantAddress, applicantCity, applicantState, applicantPincode]);

  const handleSave = async () => {
    if (!draft.Name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const isNew = editingId === "new";
      const url = isNew ? `${CO_APPLICANT_API}/application/${applicationId}` : `${CO_APPLICANT_API}/${editingId}`;
      const res = await fetchWithAuth(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success(isNew ? "Co-applicant added" : "Co-applicant updated");
      cancelEdit();
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${CO_APPLICANT_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Users2 size={13} /> Co-Applicants</label>
        {(coApplicants as any[]).length > 0 ? (
          <div className="space-y-1.5">
            {(coApplicants as any[]).map((co: any) => (
              <div key={co.Id}
                onClick={() => setViewingCoApplicant(co)}
                className="flex items-center justify-between text-xs rounded-md bg-muted/30 px-2.5 py-1.5 cursor-pointer hover:bg-muted/50">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{co.Name}</span>
                  {co.Relation && <span className="text-muted-foreground">({co.Relation})</span>}
                  {co.Mobile && <span className="text-muted-foreground">— {co.Mobile}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); startEdit(co); }} className="text-primary hover:underline">Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(co.Id); }} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No co-applicants added yet — optional.</p>
        )}
        {editingId === null && (
          <button onClick={startAdd}
            className="text-xs px-3 py-1.5 border border-border rounded-md text-primary hover:bg-muted/40 flex items-center gap-1">
            <Plus size={12} /> Add Co-Applicant
          </button>
        )}
      </div>

      {editingId !== null && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input value={draft.Name} onChange={(e) => setDraft((d: any) => ({ ...d, Name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Relation</label>
              <select value={draft.Relation} onChange={(e) => setDraft((d: any) => ({ ...d, Relation: e.target.value }))} className={inputCls}>
                <option value="">Select</option>
                <option value="Spouse">Spouse</option>
                <option value="Son">Son</option>
                <option value="Daughter">Daughter</option>
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Brother">Brother</option>
                <option value="Sister">Sister</option>
                <option value="Friend">Friend</option>
                <option value="Business Partner">Business Partner</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Mobile</label>
              <input value={draft.Mobile} onChange={(e) => setDraft((d: any) => ({ ...d, Mobile: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input value={draft.Email} onChange={(e) => setDraft((d: any) => ({ ...d, Email: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>PAN</label>
              <input value={draft.PanNo} onChange={(e) => setDraft((d: any) => ({ ...d, PanNo: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Aadhaar No.</label>
              <input value={draft.AadhaarNo} onChange={(e) => setDraft((d: any) => ({ ...d, AadhaarNo: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Date of Birth</label>
              <input type="date" value={draft.DateOfBirth} onChange={(e) => setDraft((d: any) => ({ ...d, DateOfBirth: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Gender</label>
              <select value={draft.Gender} onChange={(e) => setDraft((d: any) => ({ ...d, Gender: e.target.value }))} className={inputCls}>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Occupation</label>
              <input value={draft.Occupation} onChange={(e) => setDraft((d: any) => ({ ...d, Occupation: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Annual Income</label>
              <input type="number" value={draft.AnnualIncome} onChange={(e) => setDraft((d: any) => ({ ...d, AnnualIncome: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + " mb-0"}>Address</label>
              {applicantAddress && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={sameAsApplicant}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSameAsApplicant(checked);
                      if (checked) {
                        setDraft((d: any) => ({
                          ...d, Address: applicantAddress || "", City: applicantCity || "",
                          State: applicantState || "", Pincode: applicantPincode || "",
                        }));
                      }
                    }}
                    className="rounded border-border" />
                  Same as {applicantName || "applicant"}'s address
                </label>
              )}
            </div>
            <input value={draft.Address} readOnly={sameAsApplicant}
              onChange={(e) => setDraft((d: any) => ({ ...d, Address: e.target.value }))}
              className={inputCls + (sameAsApplicant ? " bg-muted/30 text-muted-foreground cursor-not-allowed" : "")} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>City</label>
              <input value={draft.City} readOnly={sameAsApplicant}
                onChange={(e) => setDraft((d: any) => ({ ...d, City: e.target.value }))}
                className={inputCls + (sameAsApplicant ? " bg-muted/30 text-muted-foreground cursor-not-allowed" : "")} />
            </div>
            <div>
              <label className={labelCls}>State</label>
              <input value={draft.State} readOnly={sameAsApplicant}
                onChange={(e) => setDraft((d: any) => ({ ...d, State: e.target.value }))}
                className={inputCls + (sameAsApplicant ? " bg-muted/30 text-muted-foreground cursor-not-allowed" : "")} />
            </div>
            <div>
              <label className={labelCls}>Pincode</label>
              <input value={draft.Pincode} readOnly={sameAsApplicant}
                onChange={(e) => setDraft((d: any) => ({ ...d, Pincode: e.target.value }))}
                className={inputCls + (sameAsApplicant ? " bg-muted/30 text-muted-foreground cursor-not-allowed" : "")} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={draft.Notes} onChange={(e) => setDraft((d: any) => ({ ...d, Notes: e.target.value }))} rows={2} className={`${inputCls} resize-none`} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={cancelEdit} className="px-3 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Plain custom overlay instead of the shadcn/Radix <Dialog> — this
          popup opens while the wizard's own Dialog is already open, and
          nesting two Radix Dialogs is a known source of a stuck
          pointer-events/focus-trap state on the outer dialog once the inner
          one closes (symptom: buttons like Edit stop responding). A plain
          div-based overlay sidesteps that entirely. */}
      {viewingCoApplicant && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setViewingCoApplicant(null)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-sm font-semibold text-foreground flex items-center gap-2">
                <Users2 size={16} />
                {viewingCoApplicant.Name}
                {viewingCoApplicant.Relation && (
                  <span className="text-xs font-normal text-muted-foreground">({viewingCoApplicant.Relation})</span>
                )}
              </h3>
              <button onClick={() => setViewingCoApplicant(null)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><span className="text-muted-foreground">Mobile:</span> <span className="text-foreground">{viewingCoApplicant.Mobile || "—"}</span></div>
              <div><span className="text-muted-foreground">Email:</span> <span className="text-foreground">{viewingCoApplicant.Email || "—"}</span></div>
              <div><span className="text-muted-foreground">PAN:</span> <span className="text-foreground">{viewingCoApplicant.PanNo || "—"}</span></div>
              <div><span className="text-muted-foreground">Aadhaar No.:</span> <span className="text-foreground">{viewingCoApplicant.AadhaarNo || "—"}</span></div>
              <div><span className="text-muted-foreground">Date of Birth:</span> <span className="text-foreground">{viewingCoApplicant.DateOfBirth ? String(viewingCoApplicant.DateOfBirth).slice(0, 10) : "—"}</span></div>
              <div><span className="text-muted-foreground">Gender:</span> <span className="text-foreground">{viewingCoApplicant.Gender || "—"}</span></div>
              <div><span className="text-muted-foreground">Occupation:</span> <span className="text-foreground">{viewingCoApplicant.Occupation || "—"}</span></div>
              <div><span className="text-muted-foreground">Annual Income:</span> <span className="text-foreground">{viewingCoApplicant.AnnualIncome != null && viewingCoApplicant.AnnualIncome !== "" ? viewingCoApplicant.AnnualIncome : "—"}</span></div>
              <div className="col-span-2"><span className="text-muted-foreground">Address:</span> <span className="text-foreground">{viewingCoApplicant.Address || "—"}</span></div>
              <div><span className="text-muted-foreground">City:</span> <span className="text-foreground">{viewingCoApplicant.City || "—"}</span></div>
              <div><span className="text-muted-foreground">State:</span> <span className="text-foreground">{viewingCoApplicant.State || "—"}</span></div>
              <div><span className="text-muted-foreground">Pincode:</span> <span className="text-foreground">{viewingCoApplicant.Pincode || "—"}</span></div>
              {viewingCoApplicant.Notes && (
                <div className="col-span-2"><span className="text-muted-foreground">Notes:</span> <span className="text-foreground">{viewingCoApplicant.Notes}</span></div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={() => { const co = viewingCoApplicant; setViewingCoApplicant(null); startEdit(co); }}
                className="px-3 py-1.5 text-xs border border-border rounded-md text-primary hover:bg-muted/40">
                Edit
              </button>
              <button type="button" onClick={() => setViewingCoApplicant(null)}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Step 5: Attachments — document upload only ─────────────────────────────────
const AttachmentsStep: React.FC<{
  applicationId: number;
}> = ({ applicationId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: docData, refetch: refetchDocs } = useQuery({
    queryKey: ["crm-app-documents", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${DOC_API}/application/${applicationId}`);
      return r.ok ? r.json() : { documents: [] };
    },
  });

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!docType) { toast.error("Select a document type before uploading"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docType);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${DOC_API}/application/${applicationId}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocType("");
      refetchDocs();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveDoc = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${DOC_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchDocs();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><FileText size={13} /> Documents</label>
        <div className="flex gap-2">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${inputCls} flex-1`}>
            <option value="">Select document type</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading || !docType}
            className="px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-md hover:bg-primary/20 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
            <Upload size={12} /> {uploading ? "Uploading..." : "Upload"}
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleUploadFiles(e.target.files)} />
        </div>
        <div className="space-y-1">
          {(docData?.documents || []).map((d: any) => (
            <div key={d.Id} className="flex items-center justify-between text-xs rounded-md bg-muted/30 px-2.5 py-1.5">
              <span className="truncate">{d.DocumentType} — {d.FileName}</span>
              <button onClick={() => handleRemoveDoc(d.Id)} className="text-muted-foreground hover:text-red-600 shrink-0"><Trash2 size={12} /></button>
            </div>
          ))}
          {(!docData?.documents || docData.documents.length === 0) && (
            <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CrmApplication;