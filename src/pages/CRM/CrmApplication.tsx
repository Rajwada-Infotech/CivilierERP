import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ChevronRight, CheckCircle2, Clock, XCircle, Building2, IdCard, ExternalLink, ChevronLeft, Trash2, FileText, User, Phone, FileBadge, MapPin, IndianRupee, Users2, Briefcase, PlayCircle, Ban, Lock, Wallet, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useGstRates, computeUnitParkingGst } from "@/lib/crmGst";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmInvoiceList } from "@/components/crm/CrmInvoiceList";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { API, EMPTY_FORM, BANK_DETAIL_API, PARKING_API, EXTRA_CHARGE_API, CO_APPLICANT_API, PAY_MODES, STATUSES, appTone, RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED, fetchProjectBanks, fetchAllBanks, PAGE_SIZE, type ApplicationListFilters, fetchApplicationsList, fetchStageCounts, fetchAppDetail, STAGES, type Stage, stageLabel, stageIcon, normalizeRole, fetchCustomers, fetchLeadOptions, fetchCompanies, fetchProjects, fetchUnits, fetchPlots, fetchBrokers, fetchPaymentPlans, fetchBlockPlanTags, type RateTier, fetchBrokerageRateTiers, parseMilestones, inputCls, labelCls } from "./applications/config";
import { GstBreakdownBox } from "./applications/GstBreakdown";
import { CoApplicantStep } from "./applications/CoApplicantStep";
import { ApplicationFormPdfDialog } from "./applications/ApplicationFormPdfDialog";
import { BankDetailsStep } from "./applications/BankDetailsStep";
import { ParkingSelectionStep } from "./applications/ParkingSelectionStep";
import { ExtraWorkSelectionStep } from "./applications/ExtraWorkSelectionStep";
import { AttachmentsStep } from "./applications/AttachmentsStep";

const CrmApplication: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser, canDoAction } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(normalizeRole(currentUser?.role));
  const canEditApplications = canDoAction("crm-applications", "edit");
  const canCreateApplications = canDoAction("crm-applications", "create");
  const canRequestBookingCancellation = canDoAction("crm-cancellations", "create");
  const [searchInput, setSearchInput] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [activeStage, setActiveStage] = useState<Stage>("InProcess");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(1);
  // Furthest step this application has actually reached — persisted
  // server-side as CrmApplication.CurrentStep so Resume can land back where
  // the user left off, and so the stepper tabs can be clicked to jump to
  // anything already visited.
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  // Plot or villa/unit, when the project sells both (see saleKind below).
  const [saleKindChoice, setSaleKindChoice] = useState<"plot" | "unit" | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingApplication, setLoadingApplication] = useState(false);
  const [hasBooking, setHasBooking] = useState(false);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [applicationNo, setApplicationNo] = useState<string | null>(null);
  // Status of the application currently open in the wizard, as loaded from
  // the server (null while creating a brand-new one in step 1). Drives
  // whether the Project/Unit tree can be unlocked for editing at all — see
  // canEditUnitSelection below. Kept separate from `form` since it's never
  // itself an editable field.
  const [wizardAppStatus, setWizardAppStatus] = useState<string | null>(null);
  // Company/Project/Block/Floor/Unit/Payment Plan start locked (read-only)
  // once an already-saved application is resumed — "Edit" unlocks them for
  // the (normal, expected) case of adjusting the pick before approval. Once
  // Approved, canEditUnitSelection goes false and no Edit control is ever
  // shown, so this can't be unlocked at all past that point (see the
  // Project/Unit tree JSX).
  const [unitLocked, setUnitLocked] = useState(false);
  // Same lock/Edit pattern as the Project/Unit tree above, applied to the
  // Payment Details block (Token Amount, Payment Mode, Cheque/Transaction
  // Ref, Deposited-To bank). Without this, resuming an already-submitted
  // (Pending) application left every one of those fields sitting wide open
  // and re-editable with zero friction — an easy way to accidentally
  // overwrite a figure the customer already confirmed and create a
  // mismatch between what Finance approved and what's actually on file.
  // Gated by the same canEditUnitSelection (Draft/Pending only) — once
  // Approved, no Edit control renders and this can't be unlocked at all.
  const [paymentLocked, setPaymentLocked] = useState(false);

  // (No more planLocked/auto-fetch state — Unit Master no longer has a
  // single "default" plan to silently apply; Payment Plan is always an
  // explicit, mandatory pick once a unit is on the application.)
  const [viewingAppId, setViewingAppId] = useState<number | null>(null);
  const [pdfDialogApp, setPdfDialogApp] = useState<{ id: number; no: string } | null>(null);
  const saveBankDetailsRef = useRef<null | (() => Promise<void>)>(null);

  // Row clicks only ever set local state — the URL stayed plain
  // /crm/applications, so a refresh lost the open detail dialog and there
  // was nothing to copy/bookmark/share to jump straight back to this
  // application. openApplication/closeApplication keep ?id= in sync with
  // the dialog's actual open/closed state, same pattern as CrmBooking.tsx's
  // ?view= and CrmWelcomeCall.tsx's ?bookingId=.
  const openApplication = (id: number) => {
    setViewingAppId(id);
    setSearchParams((sp) => { sp.set("id", String(id)); return sp; }, { replace: true });
  };
  const closeApplication = () => {
    setViewingAppId(null);
    setSearchParams((sp) => { sp.delete("id"); return sp; }, { replace: true });
  };

  const listFilters: ApplicationListFilters = { search, status: statusFilter, displayStage: activeStage, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId };
  const { data: listData, isLoading, isError, error } = useQuery({
    queryKey: ["crm-apps", listFilters, page, pageSize],
    queryFn: () => fetchApplicationsList(listFilters, page, pageSize),
    placeholderData: (prev) => prev,
  });
  const apps = listData?.rows || [];
  const total = listData?.total || 0;
  // Stage tab counts — same filters minus stage itself, so a badge's number
  // always matches "how many total match everything except which tab is
  // active", independent of pagination.
  const { data: stageCounts = { InProcess: 0, Converted: 0, NotConverted: 0 } } = useQuery({
    queryKey: ["crm-apps-stage-counts", search, statusFilter, cpb],
    queryFn: () => fetchStageCounts({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    placeholderData: (prev) => prev,
  });
  // Any filter change resets back to page 1 — otherwise a narrower result
  // set can strand the user on a page number that no longer exists.
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  const { data: viewingAppDetail } = useQuery({
    queryKey: ["crm-app-detail", viewingAppId],
    queryFn: () => fetchAppDetail(viewingAppId as number),
    enabled: viewingAppId != null,
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
    enabled: viewingAppId != null,
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
    enabled: viewingAppId != null,
  });
  // Same shape/endpoint as the wizard's own detailExtraCharges, keyed by
  // viewingAppId for the same reason viewingAppParking above is.
  const { data: viewingAppExtraCharges = [] } = useQuery({
    queryKey: ["crm-app-extra-charges", viewingAppId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${EXTRA_CHARGE_API}/application/${viewingAppId}`);
      return r.ok ? r.json() : [];
    },
    enabled: viewingAppId != null,
  });
  // Invoices for the application's linked booking — same source and shape
  // the Booking Detail page uses, rendered through the shared CrmInvoiceList
  // so they read identically everywhere. Read-only here; invoices are
  // generated only on the CRM Invoices page.
  const viewingAppBookingId = (viewingAppDetail?.bookings || [])[0]?.Id ?? null;
  const { data: viewingAppInvoices = [] } = useQuery({
    queryKey: ["crm-app-invoices", viewingAppBookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/crm/bookings/${viewingAppBookingId}/invoices`);
      return r.ok ? r.json() : [];
    },
    enabled: viewingAppBookingId != null,
  });
  const { data: customers = [] } = useQuery({ queryKey: ["crm-customers-dropdown"], queryFn: fetchCustomers, staleTime: 60_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["crm-leads-pool"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });
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
  const { data: plots = [] } = useQuery({ queryKey: ["plot-master"], queryFn: fetchPlots, staleTime: 30_000 });
  const { data: brokers = [] } = useQuery({ queryKey: ["crm-brokers-dropdown"], queryFn: fetchBrokers, staleTime: 5 * 60_000 });
  const { data: paymentPlans = [] } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchPaymentPlans, staleTime: 5 * 60_000 });
  const { data: rateTiers = [] } = useQuery({ queryKey: ["crm-brokerage-rate-tiers"], queryFn: fetchBrokerageRateTiers, staleTime: 5 * 60_000 });
  const { data: blockPlanTags = [] } = useQuery({ queryKey: ["crm-app-block-plan-tags"], queryFn: fetchBlockPlanTags, staleTime: 5 * 60_000 });
  const { data: crmGstRates } = useGstRates();
  // Same queryKey ParkingSelectionStep (Step 2) uses for this applicationId
  // — react-query dedupes/caches across the two, so the Details tab (Step
  // 6) can show the parking total without firing its own separate fetch.
  const { data: detailParkingAllotments = [] } = useQuery({
    queryKey: ["crm-app-parking", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
    enabled: applicationId != null,
  });
  // Pre-tax base (RateSnapshot x Quantity) — for the GST preview box, which
  // needs to compute its own rate/amount from a clean base, not sum a
  // TotalAmount that may already carry a different (soon to be replaced) rate.
  const detailParkingBase = (detailParkingAllotments as any[]).reduce((s, a) => s + (Number(a.RateSnapshot) || 0) * (Number(a.Quantity) || 1), 0);
  // Same queryKey ExtraWorkSelectionStep (Step 3) uses for this applicationId.
  const { data: detailExtraCharges = [] } = useQuery({
    queryKey: ["crm-app-extra-charges", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${EXTRA_CHARGE_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
    enabled: applicationId != null,
  });
  const detailExtraChargesTotal = (detailExtraCharges as any[]).reduce((s, c) => s + (Number(c.TotalAmount) || 0), 0);

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
      // land is sold as a plot (the plot picker), never as a unit
      && !u.IsLand
      && (!(u.LockBookingNo || u.LockHoldId) || String(u.Id) === form.PreferredUnitIds[0])
    );
  }, [units, form.ProjectId, form.PreferredUnitIds[0]]);
  const plotsForProject = useMemo(
    () => (plots as any[]).filter((plot: any) =>
      String(plot.ProjectId) === form.ProjectId
      && (!(plot.LockBookingNo || plot.LockApplicationNo || plot.LockHoldId)
        || form.PreferredPlotIds.includes(String(plot.Id)))
    ),
    [plots, form.ProjectId, form.PreferredPlotIds],
  );
  const blocksForProject = useMemo(() => {
    const map = new Map<string, string>();
    // Blocks holding anything for sale — plots and constructed units alike.
    [...plotsForProject, ...unitsForProject].forEach((u: any) => { if (u.BlockId) map.set(String(u.BlockId), u.BlockName); });
    return Array.from(map, ([Id, Name]) => ({ Id, Name }));
  }, [unitsForProject, plotsForProject, form.PreferredPlotIds.length]);
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
    (units as any[]).find((u: any) => String(u.Id) === form.PreferredUnitIds[0]) || null,
    [units, form.PreferredUnitIds[0]]
  );
  const selectedPlots = useMemo(() =>
    (plots as any[]).filter((plot: any) => form.PreferredPlotIds.includes(String(plot.Id))),
    [plots, form.PreferredPlotIds],
  );
  const selectedInventory = selectedUnit || selectedPlots[0] || null;
  const hasInventorySelection = form.PreferredUnitIds.length > 0 || form.PreferredPlotIds.length > 0;
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
  // /for-project already resolves the full exclusivity rule server-side
  // (tagged-only, or every untagged bank as the fallback pool) — falling
  // back further to the raw, unfiltered bank list here would silently
  // reintroduce banks tagged exclusively to a DIFFERENT project. Only use
  // the raw list when no Project is even picked yet (nothing to scope by).
  const bankOptions = form.ProjectId ? projectBanks : allBanks;
  useEffect(() => {
    // no deposit bank auto-pick — Accounts assigns it on the Received
    // Payment before approval (same rule for every CRM payment)
  }, [projectBanks]);
  // Project -> Block -> Unit cascade (see crmEntityCreation.js's
  // getApplicablePaymentPlans, the same source of truth the backend uses to
  // validate the actual save) — stop at the first non-empty tier: the
  // Unit's own tags, else its Block's, else its Project's, else every
  // active plan. Either way a plan must be picked once a unit is on the
  // application — there's no more "leave blank for the default split" option.
  const unitTaggedPaymentPlans = useMemo(() => {
    if (!selectedInventory?.PaymentPlanIds) return [];
    const taggedIds: string[] = String(selectedInventory.PaymentPlanIds).split(",").filter(Boolean);
    return (paymentPlans as any[]).filter((p: any) => p.IsActive && taggedIds.includes(String(p.Id)));
  }, [paymentPlans, selectedInventory]);
  const blockTaggedPaymentPlans = useMemo(() => {
    if (!selectedInventory?.BlockId) return [];
    const blockRow = (blockPlanTags as any[]).find((b: any) => String(b.Id) === String(selectedInventory.BlockId));
    if (!blockRow?.PaymentPlanIds) return [];
    const taggedIds: string[] = String(blockRow.PaymentPlanIds).split(",").filter(Boolean);
    return (paymentPlans as any[]).filter((p: any) => p.IsActive && taggedIds.includes(String(p.Id)));
  }, [paymentPlans, blockPlanTags, selectedInventory]);
  const projectTaggedPaymentPlans = useMemo(() => {
    if (!selectedInventory?.ProjectId) return [];
    return (paymentPlans as any[]).filter((p: any) =>
      p.IsActive && p.ProjectIds && String(p.ProjectIds).split(",").includes(String(selectedInventory.ProjectId)));
  }, [paymentPlans, selectedInventory]);
  const activePaymentPlans = useMemo(() => (paymentPlans as any[]).filter((p: any) => p.IsActive), [paymentPlans]);
  const applicablePaymentPlans = unitTaggedPaymentPlans.length
    ? unitTaggedPaymentPlans
    : blockTaggedPaymentPlans.length
      ? blockTaggedPaymentPlans
      : projectTaggedPaymentPlans.length
        ? projectTaggedPaymentPlans
        : activePaymentPlans;

  // Resume is only meaningful for a genuinely incomplete application. In
  // practice that's Status={CrmStatus.PENDING} — POST / (createCrmApplicationRecord)
  // inserts new applications straight into 'Pending', not 'Draft', so the
  // Draft check below is kept only for backward compatibility (an older
  // record, or a future path that writes it) and doesn't fire in the normal
  // flow. This used to be guessed from which form fields happened to be
  // empty, which was fragile in both directions: a fully submitted Pending
  // application with a blank (optional) Notes field would incorrectly show
  // Resume, while other field combinations could just as easily fail to show
  // it on a genuinely incomplete one. Status is the real answer; stop guessing.
  //
  // BUG FIX: Status alone isn't enough — a Booking is auto-attempted the
  // moment an Application is submitted (see PUT /:id/submit), and Status
  // stays 'Pending' on the Application even after that Booking exists and
  // is later Approved (Status only ever moves to 'Approved'/'Rejected' via
  // the Application's own, now-mostly-vestigial transitions). Without also
  // checking Stage, a fully Converted application (real Booking, possibly
  // already Approved) still shows Resume — reopening the wizard and
  // resubmitting tries to book the SAME unit a second time, which the
  // backend correctly rejects with "This unit is already booked", but the
  // button should never have been offered in the first place. Stage is
  // computed server-side from whether a live Booking exists (see APP_SELECT
  // in crmApplications.js) and is the actual source of truth here.
  // Draft (mid-fill, paused before full submission) — no booking yet.
  const isResumable = (app: any) => !!app && app.Stage !== "Converted" && app.Status === CrmStatus.DRAFT;
  // Submitted (Pending) or reverted (Rejected) — booking may exist but not yet
  // approved by the next level. Editable until the booking reaches Approved;
  // if the booking is reverted (Rejected), also editable again.
  // Backend PUT /:id enforces the same gate server-side.
  const isEditableApplication = (app: any) =>
    !!app &&
    [CrmStatus.PENDING, CrmStatus.REJECTED].includes(app.Status) &&
    (app.Stage !== "Converted" || app.BookingStatus !== CrmStatus.APPROVED);
  // Kept for any callers that still reference it (row-level canResume).
  const isResumeEditable = (app: any) => isResumable(app) || isEditableApplication(app);

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
  // What this sale is, from what the project actually has for sale: plots
  // (land), constructed units (flats, villas), or both — a plotted project
  // with converted villas sells either. An existing pick decides the mode;
  // otherwise the user chooses, defaulting to what the project has.
  const projectHasPlots = plotsForProject.length > 0 || form.PreferredPlotIds.length > 0;
  const projectHasUnits = unitsForProject.length > 0 || form.PreferredUnitIds.length > 0;
  const saleKind: "plot" | "unit" =
    form.PreferredPlotIds.length ? "plot"
    : form.PreferredUnitIds.length ? "unit"
    : saleKindChoice === "unit" && projectHasUnits ? "unit"
    : saleKindChoice === "plot" && projectHasPlots ? "plot"
    : projectHasPlots ? "plot" : "unit";
  const canChooseSaleKind = projectHasPlots && projectHasUnits;
  const isPlottedProject = saleKind === "plot";

  const canEditUnitSelection = wizardAppStatus === null || wizardAppStatus === CrmStatus.DRAFT || wizardAppStatus === CrmStatus.PENDING || wizardAppStatus === CrmStatus.REJECTED;

  // Mirrors APPLICATION_TRANSITIONS in crmApplicationWorkflow.js: Cancel is a
  // business action any editor can take pre-approval — accidental filing or a
  // mistake means reapplying is cleaner than salvaging the record, and
  // cancelling releases whatever unit/parking hold it was carrying immediately
  // (see PUT /:id/cancel) instead of leaving it tied up until the hold's own
  // expiry. Once Approved, the backend refuses this transition outright — the
  // real Booking's own Cancellation Request flow is the only path from there,
  // so this never shows for an Approved application. The button itself is
  // just a convenience gate; the backend re-checks and is the real guard.
  //
  // Direct cancel is only valid before a Booking exists (Stage=InProcess/NotConverted).
  // Once a Booking is auto-created (Stage=Converted), the only cancel path is the
  // formal Cancellation Request flow — the backend enforces this too.
  const canCancelApplication = (app: any) => !!app && canEditApplications && app.Stage !== "Converted" && !["Approved", "Cancelled", "Expired"].includes(app.Status);
  // Admin delete — only when no live booking exists (Stage !== Converted).
  // On a Converted application the booking is live and has real financial
  // history; the backend rejects deletes in that state, so don't offer the
  // button either (misleading to show a destructive action that will always fail).
  const canDeleteApplication = (app: any) => !!app && isAdmin && app.Stage !== "Converted";

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

  // Display stage (a Converted application whose booking isn't yet Approved
  // still reads as "In Process" — it's still moving through the approval
  // chain) is now computed server-side (DISPLAY_STAGE_EXPR in
  // crmApplications.js) for both the paginated list (?displayStage=) and
  // the counts endpoint, so this page no longer filters/counts client-side
  // — `apps` from the query above is already the current page's correctly
  // filtered rows, and `stageCounts` above is already the server's totals.
  const conversionRate = useMemo(() => {
    const convTotal = stageCounts.Converted + stageCounts.NotConverted;
    return convTotal > 0 ? Math.round((stageCounts.Converted / convTotal) * 100) : 0;
  }, [stageCounts]);

  // Source field is no longer editable in the wizard (see CrmApplication
  // task history), but Source is still submitted and still shown in the
  // applications table/review page — so still silently carry it over from
  // the customer's linked lead, just without the old lock/"Change" UI.
  // Only fills fields still blank, so re-selecting a different customer
  // never clobbers something staff already typed. Depends on primitive
  // ids, not the selectedCustomer/leads object references, so a background
  // query refetch (same data, new array identity) doesn't re-fire this.
  useEffect(() => {
    const leadId = selectedCustomer?.LeadId ?? null;
    if (leadId == null) return;
    const lead = (leads as any[]).find((l: any) => l.Id === leadId);
    if (!lead?.SourceType) return;
    setForm((f) => ({
      ...f,
      Source: f.Source || lead.SourceType || "",
      PlatformId: f.PlatformId || (lead.PlatformId != null ? String(lead.PlatformId) : ""),
      CampaignId: f.CampaignId || (lead.CampaignId != null ? String(lead.CampaignId) : ""),
      AdId: f.AdId || (lead.AdId != null ? String(lead.AdId) : ""),
      ChannelPartnerId: f.ChannelPartnerId || (lead.ChannelPartnerId != null ? String(lead.ChannelPartnerId) : ""),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.Id, selectedCustomer?.LeadId, leads.length]);

  // Rate auto-fills from the unit's own rate if UnitMaster carries one;
  // otherwise stays whatever staff typed (or blank, computed manually).
  useEffect(() => {
    if (selectedInventory?.RatePerSqFt && !form.RatePerSqFt) {
      setForm((f) => ({ ...f, RatePerSqFt: String(selectedInventory.RatePerSqFt) }));
    }
  }, [selectedInventory]);

  // If the unit changes to one with a different (or no) tagged-plan set,
  // clear a PaymentPlanId that no longer applies — e.g. it was one of the
  // old unit's tags but isn't one of the new unit's.
  useEffect(() => {
    if (applicationId != null) return;
    if (!form.PaymentPlanId) return;
    const stillValid = applicablePaymentPlans.some((p: any) => String(p.Id) === form.PaymentPlanId);
    if (!stillValid) setForm((f) => ({ ...f, PaymentPlanId: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, selectedUnit?.Id]);

  const computedTotal = useMemo(() => {
    const area = selectedPlots.length
      ? selectedPlots.reduce((sum: number, plot: any) => sum + (Number(plot.AreaSqFt) || 0), 0)
      : Number(selectedUnit?.AreaSqFt) || 0;
    const rate = Number(form.RatePerSqFt) || 0;
    return area && rate ? Math.round(area * rate) : 0;
  }, [selectedUnit, selectedPlots, form.RatePerSqFt]);
  const unitParkingGstPreview = useMemo(
    () => (crmGstRates ? computeUnitParkingGst(computedTotal, detailParkingBase, crmGstRates) : null),
    [crmGstRates, computedTotal, detailParkingBase],
  );

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
  // Extra Charges's own GST-inclusive total folds into GrandTotal (and, once a
  // real Booking exists, into the same shared %-based milestones via
  // recalculateRemainingMilestones) exactly like Parking — this preview
  // needs to include it too, or it understates what each later milestone %
  // will actually resolve to once the booking is created.
  const selectedPlanRemainder = Math.max(0, (unitParkingGstPreview?.total ?? computedTotal) + detailExtraChargesTotal - selectedPlanBookingAmount);

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

  // Preview only, driven by the real editable tiers (rateTiers, above) —
  // the real, final percentage/amount is computed server-side off the
  // Booking's actual TotalValue once one exists (tierBrokeragePercent in
  // crmWorkflowGuards.js reads the same table); this just gives staff a
  // rate hint at intake time. Falls back to 2% if tiers haven't loaded yet
  // or none are configured, matching the server's own fallback.
  const activeTiers = useMemo(() =>
    (rateTiers as RateTier[]).filter((t) => t.IsActive).sort((a, b) => a.MinDealValue - b.MinDealValue),
    [rateTiers]
  );
  const brokerageTierDefault = useMemo(() => {
    const match = [...activeTiers].reverse().find((t) =>
      computedTotal >= Number(t.MinDealValue) && (t.MaxDealValue == null || computedTotal < Number(t.MaxDealValue))
    );
    return match ? Number(match.RatePercent) : 2;
  }, [activeTiers, computedTotal]);
  const brokerageTierPreviewText = useMemo(() => {
    if (!activeTiers.length) return `${brokerageTierDefault}%`;
    const cr = (v: number) => `₹${(v / 10000000).toFixed(v % 10000000 === 0 ? 0 : 2)}Cr`;
    const parts = activeTiers.map((t) => {
      const range = Number(t.MinDealValue) === 0
        ? `< ${cr(Number(t.MaxDealValue))}`
        : t.MaxDealValue == null
        ? `≥ ${cr(Number(t.MinDealValue))}`
        : `${cr(Number(t.MinDealValue))}–${cr(Number(t.MaxDealValue))}`;
      return `${range} → ${t.RatePercent}%`;
    });
    return `${brokerageTierDefault}% (${parts.join(", ")})`;
  }, [activeTiers, brokerageTierDefault]);

  const resetWizard = () => {
    setForm({ ...EMPTY_FORM });
    setStep(1);
    setMaxStepReached(1);
    setApplicationId(null);
    setApplicationNo(null);
    // A brand-new application starts with no status of its own.
    setWizardAppStatus(null);
    setUnitLocked(false);
    setHasBooking(false);
    setPaymentLocked(false);
  };

  // Deep-link from CrmLeads.tsx's "View Application" link (a converted lead
  // whose linked Customer already has an Application) — opens the read-only
  // detail dialog directly instead of the list-only page. One-shot guard
  // (matching CrmBooking.tsx/CrmWelcomeCall.tsx's deepLinkOpened) so this
  // doesn't refire and reopen the dialog right after closeApplication just
  // cleared ?id= — the param now persists while the dialog is open (see
  // openApplication/closeApplication above) instead of being stripped
  // immediately on read, so it's actually bookmarkable/shareable/
  // refresh-safe rather than a fire-once-only redirect.
  const [appDeepLinkOpened, setAppDeepLinkOpened] = useState(false);
  useEffect(() => {
    if (appDeepLinkOpened) return;
    const id = searchParams.get("id");
    if (id) {
      setAppDeepLinkOpened(true);
      setViewingAppId(parseInt(id));
    }
  }, [searchParams, appDeepLinkOpened]);

  // "Start villa application" from the Bookings page's villa-offer list: a new
  // application for the plot's owner, the villa already chosen.
  const [villaOfferOpened, setVillaOfferOpened] = useState(false);
  useEffect(() => {
    if (villaOfferOpened) return;
    const unit = searchParams.get("newVilla");
    if (!unit) return;
    setVillaOfferOpened(true);
    resetWizard();
    setSaleKindChoice("unit");
    setForm((f) => ({
      ...f,
      CustomerId: searchParams.get("customer") || "",
      CompanyId: searchParams.get("company") || "",
      ProjectId: searchParams.get("project") || "",
      BlockId: searchParams.get("block") || "",
      PreferredUnitIds: [unit],
    }));
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, villaOfferOpened]);

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
      setHasBooking((body.bookings || []).length > 0);

      // ChequeNo/ChequeDate/TransactionRef live on CrmCustomerBankDetail
      // (keyed by ApplicationId), not on CrmApplication itself — same table
      // BankDetailsStep's own KYC form reads/writes, since that's the
      // existing place a payment instrument's reference is stored (see
      // crmEntityCreation.js's auto-sync, which already reads these three
      // columns from there when creating the Booking).
      const bankDetail = await fetchWithAuth(`${BANK_DETAIL_API}/application/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      setApplicationId(app.Id);
      setApplicationNo(app.ApplicationNo || null);
      setForm((f) => ({
        ...f,
        CustomerId: app.CustomerId != null ? String(app.CustomerId) : "",
        CompanyId: app.CompanyId != null ? String(app.CompanyId) : "",
        ProjectId: app.ProjectId != null ? String(app.ProjectId) : "",
        BlockId: app.BlockId != null ? String(app.BlockId) : "",
        PreferredUnitIds: app.PreferredUnitIdsCsv ? app.PreferredUnitIdsCsv.split(',') : (app.PreferredUnitId != null ? [String(app.PreferredUnitId)] : []),
        PreferredPlotIds: app.PreferredPlotIdsCsv ? app.PreferredPlotIdsCsv.split(',') : [],
        PaymentPlanId: app.PaymentPlanId != null ? String(app.PaymentPlanId) : "",
        RatePerSqFt: app.RatePerSqFt != null ? String(app.RatePerSqFt) : "",
        DateOfApply: app.DateOfApply ? String(app.DateOfApply).slice(0, 10) : new Date().toISOString().slice(0, 10),
        Source: app.Source || "",
        PlatformId: app.PlatformId != null ? String(app.PlatformId) : "",
        CampaignId: app.CampaignId != null ? String(app.CampaignId) : "",
        AdId: app.AdId != null ? String(app.AdId) : "",
        ChannelPartnerId: app.ChannelPartnerId != null ? String(app.ChannelPartnerId) : "",
        ViaBroker: app.BrokerId != null,
        BrokerId: app.BrokerId != null ? String(app.BrokerId) : "",
        BrokerageRatePercent: app.BrokerageRatePercent != null ? String(app.BrokerageRatePercent) : "",
        BrokeragePaymentPlan: ["OneTime", "TwoPart", "AgreementOnly"].includes(app.BrokeragePaymentPlan) ? app.BrokeragePaymentPlan : "OneTime",
        Notes: app.Notes || "",
        TokenType: app.TokenType || "Percentage",
        TokenValue: app.TokenValue != null ? String(app.TokenValue) : "",
        PaymentMode: app.PaymentMode || "",
        DepositBankId: app.DepositBankId != null ? String(app.DepositBankId) : "",
        ChequeNo: bankDetail?.ChequeNo || "",
        ChequeDate: bankDetail?.ChequeDate ? String(bankDetail.ChequeDate).slice(0, 10) : "",
        TransactionRef: bankDetail?.TransactionRef || "",
      }));
      setWizardAppStatus(app.Status || null);

      const hasProject = app.CompanyId != null && app.ProjectId != null && (app.PreferredUnitId != null || !!app.PreferredPlotIdsCsv);
      // A plot sale has no Parking step (step 2), so it never resumes there.
      const firstStepAfterProject = app.PreferredPlotIdsCsv ? 3 : 2;
      // Lock the Project/Unit tree the same way Source locks once
      // auto-fetched — there's already a saved pick here, so default to
      // showing it read-only with an Edit control rather than inviting an
      // accidental reselection every time the wizard is reopened. Resume is
      // only ever reachable for Draft/Pending (see isResumeEditable), so
      // Edit is always available here in practice; canEditUnitSelection
      // below still gates it defensively in case that ever changes.
      setUnitLocked(hasProject);
      // Same idea as the Project/Unit lock just above: if a token
      // amount/payment mode was already captured on a previous visit to
      // this step, default to showing it read-only — Edit unlocks it for a
      // genuine correction. A brand-new application that's never reached
      // Details yet has nothing to protect, so it opens unlocked.
      const hasPaymentData = !!app.TokenValue || !!app.PaymentMode;
      setPaymentLocked(hasPaymentData);
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
      const resumeStep = hasProject ? Math.min(6, Math.max(firstStepAfterProject, savedStep)) : 1;
      setStep(resumeStep);
      setMaxStepReached(resumeStep);
      setDialogOpen(true);
    } catch (e: any) {
      toast.error(translateError(e.message));
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
    if (!form.PreferredUnitIds?.length && !form.PreferredPlotIds?.length) { toast.error("Select a unit or plot"); return; }
    if (form.RatePerSqFt === "" || Number(form.RatePerSqFt) <= 0) { toast.error("Enter a valid Rate (₹/sqft)"); return; }
    // Plot sales have no payment plan: Booking Amount, then the balance.
    if (!form.PreferredPlotIds?.length && !form.PaymentPlanId) { toast.error("Select a Payment Plan for this unit"); return; }
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
        PreferredUnitIds: form.PreferredUnitIds || [],
        PreferredPlotIds: form.PreferredPlotIds || [],
        PaymentPlanId: form.PreferredPlotIds?.length ? null : (form.PaymentPlanId || null),
        RatePerSqFt: form.RatePerSqFt || null,
        DateOfApply: form.DateOfApply || null,
        Source: form.Source || null,
        PlatformId: form.PlatformId || null,
        CampaignId: form.CampaignId || null,
        AdId: form.AdId || null,
        ChannelPartnerId: form.ChannelPartnerId || null,
        BrokerId: form.ViaBroker && form.BrokerId ? parseInt(form.BrokerId) : null,
        BrokerageRatePercent: form.ViaBroker && form.BrokerageRatePercent !== "" ? form.BrokerageRatePercent : null,
        BrokeragePaymentPlan: form.ViaBroker ? form.BrokeragePaymentPlan : "OneTime",
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
        if (form.PreferredUnitIds[0]) qc.invalidateQueries({ queryKey: ["unit-master"] });
        if (form.PreferredPlotIds.length) qc.invalidateQueries({ queryKey: ["plot-master"] });
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
      setHasBooking(false);
      // Freshly created — always Draft, and stays unlocked since this is the
      // same step-1 pick that was just made, not yet a saved value to guard.
      setWizardAppStatus("Draft");
      setUnitLocked(false);
      toast.success(`Application ${data.ApplicationNo} created`);
      // A hold on the picked unit is placed server-side as part of creation
      // (see createCrmApplicationRecord) — refresh so this session's own
      // dropdown reflects it right away rather than waiting out staleTime.
      if (form.PreferredUnitIds[0]) qc.invalidateQueries({ queryKey: ["unit-master"] });
      if (form.PreferredPlotIds.length) qc.invalidateQueries({ queryKey: ["plot-master"] });
      // applicationId (state) won't be updated yet on this render, so
      // advanceStep's saveApplicationFields (which reads applicationId
      // from state) would no-op — patch CurrentStep directly against the
      // id we just got back instead.
      // A plot sale has no parking — go straight to Extra Charges.
      const nextStep = form.PreferredPlotIds.length ? 3 : 2;
      setStep(nextStep);
      setMaxStepReached((m) => Math.max(m, nextStep));
      fetchWithAuth(`${API}/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CurrentStep: nextStep }),
      }).catch(() => {});
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // Steps 2-4 save against the real applicationId as staff move forward —
  // each "Next" just persists whatever that step owns.
  const saveApplicationFields = async (patch: Record<string, any>) => {
    if (applicationId == null) return;
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
      advanceStep(5);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleFinalSave = async () => {
    setSaving(true);
    try {
      await saveApplicationFields({
        Notes: form.Notes || null,
        // The field is always ₹ ("Amount"); a plot sale has no plan to supply
        // the Booking Amount, so the typed figure is it.
        TokenType: form.PreferredPlotIds?.length ? "Amount" : (form.TokenType || null),
        TokenValue: form.TokenValue || null,
        ...(form.PreferredPlotIds?.length ? { BookingAmount: form.TokenValue || 0 } : {}),
        PaymentMode: form.PaymentMode || null,
        DepositBankId: null, // assigned by Accounts before approval
      });
      // Cheque/UTR/reference lives on CrmCustomerBankDetail, not
      // CrmApplication (see the ChequeNo/ChequeDate/TransactionRef fields
      // above and crmEntityCreation.js's auto-sync, which already reads
      // these three columns from there) — only worth writing once a
      // non-Cash mode actually gave something to reference.
      if (form.PaymentMode && form.PaymentMode !== "Cash" && (form.ChequeNo || form.ChequeDate || form.TransactionRef)) {
        await fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ChequeNo: form.ChequeNo || null,
            ChequeDate: form.ChequeDate || null,
            TransactionRef: form.TransactionRef || null,
          }),
        }).catch(() => {});
      }
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
          if (subData.booking.alreadyExists) {
            toast.success("Application edits submitted successfully");
          } else {
            toast.success(`Booking ${subData.booking.BookingNo} created — payment milestones auto-generated`);
          }
      } else if (subData.bookingError) {
        // Auto-create failed (e.g. a unit-hold conflict in the interim) —
        // the Application itself still submitted fine; staff can retry via
        // the "Create Booking" button on the Applications list.
        toast.warning(`Application submitted, but the booking couldn't be created automatically: ${subData.bookingError}`);
      } else {
        toast.success("Application submitted");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
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
      toast.error(translateError(e.message));
    } finally {
      setCancelling(false);
    }
  };
  const handleDeleteApplication = async (a: any) => {
    if (!window.confirm(`Delete application ${a.ApplicationNo}? This is only allowed before a live booking has progressed.`)) return;
    try {
      const res = await fetchWithAuth(`${API}/${a.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete application");
      toast.success(data.message || "Application deleted");
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      qc.invalidateQueries({ queryKey: ["unit-master"] });
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      if (viewingAppId === a.Id) closeApplication();
    } catch (e: any) {
      toast.error(translateError(e.message));
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
          BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokeragePaymentPlan: a.BrokeragePaymentPlan,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create booking");
      toast.success(`Booking ${data.BookingNo} created — payment milestones auto-generated`);
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      navigate(`/crm/bookings?applicationId=${a.Id}`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setCreatingBookingId(null);
    }
  };
  const convertedColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ApplicationNo", header: "App No", size: 120,
      cell: (i) => (
        <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer font-heading tabular-nums text-xs font-semibold text-primary hover:underline">
          {i.getValue() as string}
        </span>
      ) },
    {/* Mobile folded into this cell — same rationale/pattern as
       inProcessColumns above. Sizes across this set are generous (sum
       ~1420px) so table-layout:fixed fills a normal desktop card
       edge-to-edge instead of bunching columns on the left. */
      accessorKey: "ApplicantName", header: "Applicant", size: 210,
      cell: (i) => (
        <div onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium text-foreground"><ApplicantNames name={i.row.original.ApplicantName} bookingId={i.row.original.BookingId} applicationId={i.row.original.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground">
            {i.row.original.Mobile}
            {i.row.original.LeadUid ? ` · Lead: ${i.row.original.LeadUid}` : ""}
          </div>
        </div>
      ) },
    { accessorKey: "BookingNo", header: "Booking", size: 190,
      cell: (i) => (
        <div onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer">
          <div className="font-heading tabular-nums text-xs font-semibold text-foreground">{i.row.original.BookingNo}</div>
          <SheetMark text={i.row.original.BookingStatus || "—"} tone={i.row.original.BookingStatus ? appTone(i.row.original.BookingStatus) : "none"} />
        </div>
      ) },
    { id: "unitProject", header: "Unit / Project", size: 220, enableSorting: false,
      cell: (i) => (
        <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-xs">
          {[i.row.original.BookingProjectName, i.row.original.BookingUnitNo].filter(Boolean).join(" · ") || "—"}
        </span>
      ) },
    { accessorKey: "BookingTotalValue", header: "Value", size: 150,
      cell: (i) => {
        const val = i.row.original.BookingGrandTotal ?? i.row.original.BookingTotalValue;
        return <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-xs font-medium">{val ? `₹${Number(val).toLocaleString("en-IN")}` : "—"}</span>;
      } },
    { accessorKey: "BookingDate", header: "Booked On", size: 130,
      cell: (i) => (
        <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-xs text-muted-foreground">
          {i.row.original.BookingDate ? String(i.row.original.BookingDate).slice(0, 10) : "—"}
        </span>
      ) },
    { id: "actions", header: "", size: 240, enableSorting: false,
      cell: (i) => (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate(`/crm/bookings?applicationId=${i.row.original.Id}`)}
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Building2 size={12} /> View Booking <ChevronRight size={12} />
          </button>
          {i.row.original.Stage === "Converted" && (
            <button onClick={() => setPdfDialogApp({ id: i.row.original.Id, no: i.row.original.ApplicationNo })}
              title="Preview / download Application Form PDF"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
              <FileText size={12} /> Form
            </button>
          )}
          {(canEditApplications || canRequestBookingCancellation) && i.row.original.BookingId
            && i.row.original.BookingStatus !== CrmStatus.CANCELLED
            && i.row.original.DeedStatus !== "Registered" && (
            <button onClick={() => navigate(`/crm/cancellations?bookingId=${i.row.original.BookingId}`)}
              className="flex items-center gap-1 text-xs text-destructive hover:underline">
              <Ban size={12} /> Request Cancellation
            </button>
          )}
          {i.row.original.DeedStatus === "Registered" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Sale deed is Registered — title has legally transferred; standard cancellation is not applicable">
              <Ban size={12} /> Deed Registered
            </span>
          )}
        </div>
      ) },
  ];

  const inProcessColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ApplicationNo", header: "App No", size: 120,
      cell: (i) => (
        <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer font-heading tabular-nums text-xs font-semibold text-foreground hover:underline">
          {i.getValue() as string}
        </span>
      ) },
    {/* Mobile folded into this cell (as a second line, same pattern used on
       CrmLeads/CrmCustomers) instead of its own column — one less dedicated
       column for a value that's rarely scanned on its own, freeing real
       width back to the columns people actually compare row-to-row. Sizes
       across this whole set are generous (sum ~1420px) so table-layout:fixed
       fills a normal desktop card edge-to-edge instead of leaving the
       columns bunched on the left with dead space after Date. */
      accessorKey: "ApplicantName", header: "Applicant", size: 220,
      cell: (i) => (
        <div onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium text-foreground"><ApplicantNames name={i.row.original.ApplicantName} bookingId={i.row.original.BookingId} applicationId={i.row.original.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground">
            {i.row.original.Mobile}
            {i.row.original.LeadUid ? ` · Lead: ${i.row.original.LeadUid}` : ""}
          </div>
        </div>
      ) },
    { id: "interestedProject", header: "Interested Project", size: 220, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        const typeBit = [r.BhkPreference, r.PropertyType].filter(Boolean).join(" · ") || r.UnitTypeFromMaster || "";
        return (
          <span onClick={() => openApplication(r.Id)} className="cursor-pointer">
            {[r.InterestedProject, typeBit].filter(Boolean).join(" · ") || "—"}
          </span>
        );
      } },
    { accessorKey: "Source", header: "Source", size: 170,
      cell: (i) => (
        <div onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-xs">
          <div>{i.row.original.Source || "—"}</div>
          <div className="text-muted-foreground">
            {[i.row.original.PlatformName, i.row.original.CampaignName, i.row.original.AdName].filter(Boolean).join(" › ") || i.row.original.ChannelPartnerName || ""}
          </div>
        </div>
      ) },
    { accessorKey: "RatePerSqFt", header: "Rate", size: 130,
      cell: (i) => <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-xs">{i.row.original.RatePerSqFt ? `₹${Number(i.row.original.RatePerSqFt).toLocaleString("en-IN")}/sqft` : "—"}</span> },
    { accessorKey: "AssigneeName", header: "Assigned To", size: 140,
      cell: (i) => <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-sm">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 130,
      cell: (i) => {
        const r = i.row.original;
        // When a live Booking exists (Stage='Converted'), the Application's
        // DB Status is permanently 'Pending' — never updated, by design.
        // Displaying "Pending" here misleads staff into thinking the record
        // still needs attention. Show "Booked" instead so the conversion is
        // immediately visible without opening the detail panel.
        const displayStatus = r.Stage === "Converted" ? "Booked" : r.Status;
        return (
          <div onClick={() => openApplication(r.Id)} className="cursor-pointer space-y-0.5">
            <SheetMark text={displayStatus} tone={appTone(displayStatus)} />
            {/* For NotConverted applications that had a booking which was later
                cancelled/rejected — show the dead booking number so staff know
                this isn't the same as an application that was simply rejected
                pre-booking. */}
            {r.Stage === "NotConverted" && r.BookingNo && (
              <div className="text-[0.625rem] text-muted-foreground font-heading tabular-nums">
                {r.BookingNo} · {r.BookingStatus}
              </div>
            )}
          </div>
        );
      } },
    { accessorKey: "CreatedAt", header: "Date", size: 110,
      cell: (i) => (
        <span onClick={() => openApplication(i.row.original.Id)} className="cursor-pointer text-xs text-muted-foreground">
          {i.row.original.CreatedAt ? String(i.row.original.CreatedAt).slice(0, 10) : "—"}
        </span>
      ) },
    { id: "actions", header: "", size: 200, enableSorting: false,
      cell: (i) => {
        const a = i.row.original;
        const canResume = canEditApplications && activeStage === "InProcess" && isResumeEditable(a);
        return (
          <div className="flex flex-col gap-1.5 py-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeStage === "InProcess" ? (
                <>
                  {canResume && (
                    <button
                      onClick={() => loadApplicationIntoWizard(a.Id)}
                      disabled={loadingApplication}
                      className={`${KEY_INK} h-7 px-2`}
                    >
                      <PlayCircle size={12} /> {loadingApplication ? "Loading..." : isResumable(a) ? "Resume" : a.Status === CrmStatus.REJECTED ? "Fix & Resubmit" : "Edit"}
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
                  {/* Create Booking — only when the application has been properly
                      submitted (Status=Pending) AND a unit was picked. Draft
                      applications haven't been submitted yet so the wizard may
                      not be complete. Stage=Converted means a booking already
                      exists — retry path is not needed. */}
                  {a.Status === CrmStatus.PENDING && a.Stage !== "Converted" && (
                    a.UnitUnavailableForBooking ? (
                      <span
                        className="flex items-center gap-1 text-[0.6875rem] text-destructive"
                        title="This application's picked unit is currently booked or held by a different application — re-pick a unit before a booking can be created."
                      >
                        <XCircle size={12} /> Unit unavailable
                      </span>
                    ) : a.PreferredUnitId == null ? (
                      <span
                        className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground"
                        title="No unit was selected in the application — edit the application and pick a unit first."
                      >
                        <AlertTriangle size={12} /> No unit selected
                      </span>
                    ) : (
                      <button
                        onClick={() => handleCreateBooking(a)}
                        disabled={creatingBookingId === a.Id}
                        className={`${KEY_INK} h-7 px-2`}
                      >
                        <Building2 size={12} /> {creatingBookingId === a.Id ? "Creating..." : "Create Booking"}
                      </button>
                    )
                  )}
                  {canCancelApplication(a) && (
                    <button
                      onClick={() => { setCancellingApp(a); setCancelRemarks(""); }}
                      className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}
                    >
                      <Ban size={12} /> Cancel
                    </button>
                  )}
                  {canDeleteApplication(a) && (
                    <button
                      onClick={() => handleDeleteApplication(a)}
                      className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </>
              ) : (
                <>
                  {canCancelApplication(a) && (
                    <button
                      onClick={() => { setCancellingApp(a); setCancelRemarks(""); }}
                      className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}
                    >
                      <Ban size={12} /> Cancel
                    </button>
                  )}
                  {canDeleteApplication(a) && (
                    <button
                      onClick={() => handleDeleteApplication(a)}
                      className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </>
              )}
              {/* Application Form PDF — only after Level 1 verification (Stage=Converted,
                  i.e. the Application is Approved and a live Booking exists).
                  Backend enforces the same gate; this hides the button before that point. */}
              {a.Stage === "Converted" && (
                <button
                  onClick={() => setPdfDialogApp({ id: a.Id, no: a.ApplicationNo })}
                  title="Preview / download Application Form PDF"
                  className={`${KEY_LINE} h-7 px-2`}
                >
                  <FileText size={12} /> Form
                </button>
              )}
            </div>
            {/* Status hint lives on its own line as a plain caption, never
                inline with the buttons — that inline mixing (a link, a
                sentence, another link, all wrapping unpredictably in a
                210px cell) was what made this column look broken. */}
            {/* Status hint — contextual caption below the action buttons */}
            {activeStage === "InProcess" && a.Status === CrmStatus.DRAFT && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-foreground">
                <Clock size={10} /> Not submitted yet — complete the wizard and submit
              </span>
            )}
            {activeStage === "InProcess" && a.Status === CrmStatus.PENDING && a.PreferredUnitId == null && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-foreground">
                <AlertTriangle size={10} /> Submitted but no unit selected — edit to add a unit
              </span>
            )}
            {activeStage === "InProcess" && a.Status === CrmStatus.PENDING && a.PreferredUnitId != null && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                <Clock size={10} /> Submitted — booking not yet created
              </span>
            )}
            {activeStage !== "InProcess" && !canCancelApplication(a) && (
              <span className="text-[0.6875rem] text-muted-foreground">
                {a.BookingNo && a.BookingStatus === CrmStatus.CANCELLED
                  ? `Booking cancelled — application closed`
                  : `${a.Status} — no further action`}
              </span>
            )}
          </div>
        );
      } },
  ];

  usePageRights("crm-applications");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Applications"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Applications"
        subtitle="Every detail captured once, here. Bookings is review-only from this point on."
        action={
          canCreateApplications && (
            <button onClick={() => { resetWizard(); setDialogOpen(true); }} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              <Plus size={13} /> New application
            </button>
          )
        }
      >
      <div className="space-y-5">
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "In process", value: stageCounts.InProcess, note: "Draft or submitted, no booking yet" },
              { label: "Converted", value: stageCounts.Converted, note: "A booking was made" },
              { label: "Not converted", value: stageCounts.NotConverted, note: "Rejected, cancelled or expired" },
              { label: "Conversion rate", value: `${conversionRate}%`, note: "Converted of all closed" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: RULE }}>
          {/* overflow-y-hidden pins the vertical axis: overflow-x-auto alone turns overflow-y to auto too, and a
              sub-pixel overflow from the badges then showed a native scrollbar on this row. */}
          <div className="flex items-stretch overflow-x-auto overflow-y-hidden" style={{ borderBottom: RULE }}>
            {STAGES.map((stg) => {
              const Icon = stageIcon[stg];
              const active = activeStage === stg;
              return (
                <button key={stg} onClick={() => updateFilter(setActiveStage)(stg)}
                  className={`inline-flex items-center gap-2 px-4 h-11 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${active ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
                  style={{ borderRight: RULE_SOFT }}>
                  <Icon size={13} /> {stageLabel[stg]}
                  <span className="tabular-nums">{stageCounts[stg]}</span>
                </button>
              );
            })}
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && updateFilter(setSearch)(searchInput.trim())}
              placeholder="Search name, mobile, application no…"
              className="h-9 w-full sm:w-72 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
            {activeStage !== "Converted" && (
              <Select value={statusFilter} onValueChange={updateFilter(setStatusFilter)}>
                <SelectTrigger className="w-auto min-w-[140px] h-9 rounded-none border-foreground/40 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
            {(search || statusFilter !== "All" || cpb.companyId || cpb.projectId || cpb.blockId) && (
              <button onClick={() => { updateFilter(setSearchInput)(""); setSearch(""); setStatusFilter("All"); setCpb({ companyId: "", projectId: "", blockId: "" }); setPage(1); }}
                className={`${KEY_LINE} h-9 px-3`}>Clear filters</button>
            )}
          </div>

          {isError ? (
            <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
          ) : (
            <DataTable serverPagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
              data={apps}
              columns={activeStage === "Converted" ? convertedColumns : inProcessColumns}
              searchable={false}
              loading={isLoading}
              emptyMessage={activeStage === "Converted" ? "No converted applications match these filters." : activeStage === "NotConverted" ? "No rejected or cancelled applications match these filters." : "No applications in process match these filters."}
              className="border-0"
            />
          )}
        </div>
      </div>

      {/* New Application Dialog — 5-step wizard: what the customer is
          applying for (unit/parking/KYC/docs). No money changes hands or
          gets recorded here — that's entirely the Booking page's job. */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetWizard(); } }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 gap-4 rounded-none" style={{ border: RULE }}>
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">
              <Building2 size={14} /> New application
              {applicationNo ? <span className="text-muted-foreground font-medium tabular-nums normal-case tracking-normal text-sm">· {applicationNo}</span> : null}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator — each tab is clickable navigation to any step
              already reached (maxStepReached), so staff can jump straight
              back to e.g. Co-Applicant without walking Next through Parking
              and Bank/KYC again. A step beyond what's been reached yet isn't
              clickable — steps 2-6 all need applicationId (created in step 1)
              and Bank/KYC intentionally still gates via its own Next/Save. */}
          <div className="flex items-stretch flex-wrap" style={{ border: RULE }}>
            {[form.PreferredPlotIds.length ? "Project/Plots" : "Project/Unit", "Parking", "Extra Charges", "Bank/KYC", "Co-Applicant", "Attachments", "Details"].map((label, i) => {
              const stepNum = i + 1;
              // A plot sale has no parking step.
              if (stepNum === 2 && form.PreferredPlotIds.length) return null;
              const reachable = stepNum === 1 || (applicationId != null && stepNum <= maxStepReached);
              return (
                <React.Fragment key={label}>
                  <button
                    type="button"
                    onClick={() => reachable && setStep(stepNum)}
                    disabled={!reachable}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${
                      step === stepNum
                        ? "bg-foreground text-card"
                        : step > stepNum ? "text-foreground" : "text-muted-foreground"
                    } ${reachable ? "cursor-pointer hover:bg-primary/10" : "cursor-not-allowed opacity-50"}`}
                    style={{ borderRight: RULE_SOFT }}>
                    {step > stepNum ? <CheckCircle2 size={12} /> : <span className="w-4 text-center">{form.PreferredPlotIds.length && stepNum > 2 ? stepNum - 1 : stepNum}</span>}
                    {label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              {/* Lead -> Customer linking happens on the Customer page itself
                  (CrmCustomers.tsx's "Link to Existing Lead" picker on New
                  Customer) — Applications only ever pick a Customer. If that
                  Customer carries a LeadId, the effect below auto-fetches its
                  Source chain (locked, with a "Change" escape hatch). */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls}>Customer *</label>
                  <a href="/crm/customers" target="_blank" rel="noreferrer"
                    className="text-xs text-foreground hover:underline flex items-center gap-1">
                    <ExternalLink size={11} /> New Customer
                  </a>
                </div>
                {/* Searchable: type a name, mobile or customer number. */}
                <SearchableSelect
                  value={form.CustomerId}
                  onChange={(v) => setForm((f) => ({ ...f, CustomerId: v }))}
                  disabled={applicationId != null}
                  placeholder="Select customer"
                  searchPlaceholder="Search name, mobile or customer no..."
                  options={(customers as any[]).map((c: any) => ({
                    value: String(c.Id),
                    label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · "),
                  }))}
                />
                {selectedCustomer && (
                  <div className="mt-2 border border-border bg-muted/20 px-3 py-2 text-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-foreground"><IdCard size={12} className="text-foreground" /> {selectedCustomer.CustomerName}</div>
                    <div className="text-muted-foreground">{selectedCustomer.Mobile}{selectedCustomer.Email ? ` · ${selectedCustomer.Email}` : ""}</div>
                    <div className="text-muted-foreground">PAN: {selectedCustomer.PanNo || "—"} · {selectedCustomer.Address || "No address on file"}</div>
                  </div>
                )}
              </div>

              {/* Two columns from here on — left is the tree pick itself,
                  right is everything that pick unlocks (GST, Payment Plan,
                  Date/Rate/Value, Broker). Keeping all of it in one column
                  was what made this step tall enough to need a scroller;
                  splitting it left/right uses the wider dialog instead of
                  stacking everything vertically. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Company > Project > Block > Floor > Unit. Locked
                    (read-only-styled, disabled) once a pick is already
                    saved, same as Source below — "Edit" unlocks it for
                    changes made before approval. Once the application is
                    past Draft/Pending (canEditUnitSelection false), Edit
                    never renders at all and every field here stays
                    permanently disabled — a real Booking either exists or
                    is expected the moment it's Approved, so the unit pick
                    can't move anymore. */}
                <div className=" border border-foreground/30 bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-heading font-semibold text-foreground block">Project / Unit (tree)</label>
                    {applicationId != null && (
                      canEditUnitSelection ? (
                        unitLocked && (
                          <button type="button" onClick={() => setUnitLocked(false)}
                            className="text-xs text-foreground hover:underline shrink-0">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Company *</label>
                      <select value={form.CompanyId} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", BlockId: "", FloorNo: "", PreferredUnitIds: [], PreferredPlotIds: [], PaymentPlanId: "" }));
                        }}
                        className={inputCls}>
                        <option value="">Select company</option>
                        {(companies as any[]).map((c: any) => <option key={c.Id} value={String(c.Id)}>{c.Name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Project *</label>
                      <SearchableSelect
                        value={form.ProjectId}
                        disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                        onChange={(v) => {
                          setSaleKindChoice(null); // a new project starts from what it sells
                          setForm((f) => ({ ...f, ProjectId: v, BlockId: "", FloorNo: "", PreferredUnitIds: [], PreferredPlotIds: [], PaymentPlanId: "" }));
                        }}
                        placeholder="Select project"
                        searchPlaceholder="Search projects..."
                        options={(projectsForCompany as any[]).map((p: any) => ({ value: String(p.Id), label: p.Name }))}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Block / Tower</label>
                      <select value={form.BlockId} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, BlockId: e.target.value, FloorNo: "", PreferredUnitIds: [], PreferredPlotIds: [], PaymentPlanId: "" }));
                        }}
                        className={inputCls}>
                        <option value="">Select block</option>
                        {blocksForProject.map((b) => <option key={b.Id} value={b.Id}>{b.Name}</option>)}
                      </select>
                    </div>
                    {canChooseSaleKind && (
                      <div className="col-span-2">
                        <label className={labelCls}>Selling</label>
                        <div className="inline-flex border border-border p-0.5 bg-muted/30">
                          {([["plot", "Plot (land)"], ["unit", "Villa / unit"]] as const).map(([k, label]) => (
                            <button key={k} type="button"
                              disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                              onClick={() => {
                                if (saleKind === k) return;
                                setSaleKindChoice(k);
                                setForm((f) => ({ ...f, PreferredUnitIds: [], PreferredPlotIds: [], FloorNo: "", PaymentPlanId: "" }));
                              }}
                              className={`px-3 h-8 text-xs font-semibold transition-colors disabled:opacity-50 ${saleKind === k ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!isPlottedProject && floorsForBlock.length > 0 && <div>
                      <label className={labelCls}>Floor</label>
                      <select value={form.FloorNo} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, FloorNo: e.target.value, PreferredUnitIds: [], PreferredPlotIds: [], PaymentPlanId: "" }));
                        }}
                        className={inputCls}>
                        <option value="">Select floor</option>
                        {floorsForBlock.map((fl) => <option key={fl} value={fl}>Floor {fl}</option>)}
                      </select>
                    </div>}
                    <div className="col-span-2">
                      <label className={labelCls}>{isPlottedProject ? "Plots" : canChooseSaleKind ? "Villa / unit" : "Unit"} *</label>
                      {isPlottedProject ? (
                          <div className={unitLocked || !canEditUnitSelection ? "pointer-events-none opacity-50" : ""}>
                          <MultiSelectDropdown
                            options={(plotsForProject as any[]).map((u: any) => ({
                              id: String(u.Id),
                              label: `${u.PlotName} ${u.AreaSqFt ? '(' + u.AreaSqFt + ' sq.ft)' : ''}`,
                              group: u.BlockName
                            }))}
                            value={form.PreferredPlotIds}
                            onChange={(nextIds) => {
                              const picked = (plotsForProject as any[]).find((u: any) => nextIds.includes(String(u.Id)));
                              setForm((f) => ({
                                ...f,
                                PreferredUnitIds: [],
                                PreferredPlotIds: nextIds,
                                BlockId: picked?.BlockId != null ? String(picked.BlockId) : f.BlockId,
                                FloorNo: "",
                                PaymentPlanId: "",
                              }));
                            }}
                            placeholder="Select plots"
                            searchPlaceholder="Search plots..."
                            itemNoun="plot"
                          /></div>
                        ) : (
                          <Select value={form.PreferredUnitIds[0] || undefined} onValueChange={(id) => {
                            const picked = (unitsForProject as any[]).find((u: any) => String(u.Id) === id);
                            setForm((f) => ({
                              ...f,
                              PreferredUnitIds: [id],
                              BlockId: picked?.BlockId != null ? String(picked.BlockId) : f.BlockId,
                              FloorNo: picked?.FloorNo != null ? String(picked.FloorNo) : f.FloorNo,
                              PaymentPlanId: "",
                            }));
                          }} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}>
                            <SelectTrigger className={inputCls}>
                              <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {(unitsForProject as any[]).map((u: any) => (
                                <SelectItem key={u.Id} value={String(u.Id)}>{u.UnitName}{u.VillaTypeCode ? ` · ${u.VillaTypeCode}` : ""} {u.AreaSqFt ? `(${Number(u.AreaSqFt).toLocaleString("en-IN")} sq.ft)` : ""}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                    </div>
                  </div>

                  {/* Brief unit price — the unit's own name/type/area is
                      already visible in the Unit dropdown right above, so
                      this only needs to show the derived ₹ math itself. */}
                  {selectedUnit && (
                    <div className=" border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
                      <IndianRupee size={11} className="text-foreground shrink-0" />
                      {form.RatePerSqFt && computedTotal ? (
                        <span>
                          {selectedUnit.AreaSqFt} sqft × ₹{Number(form.RatePerSqFt).toLocaleString("en-IN")}/sqft = <span className="font-semibold text-foreground">₹{computedTotal.toLocaleString("en-IN")}</span>
                        </span>
                      ) : (
                        <span>Enter Rate (₹/sqft) to see the full price.</span>
                      )}
                    </div>
                  )}
                  {isPlottedProject && selectedPlots.length > 0 && (
                    <div className=" border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
                      <IndianRupee size={11} className="text-foreground shrink-0" />
                      {form.RatePerSqFt && computedTotal ? (
                        <span>{selectedPlots.length} plot{selectedPlots.length === 1 ? "" : "s"} · {selectedPlots.reduce((sum: number, plot: any) => sum + (Number(plot.AreaSqFt) || 0), 0).toLocaleString("en-IN")} sqft × ₹{Number(form.RatePerSqFt).toLocaleString("en-IN")}/sqft = <span className="font-semibold text-foreground">₹{computedTotal.toLocaleString("en-IN")}</span></span>
                      ) : <span>Enter Rate (₹/sqft) to see the combined plot price.</span>}
                    </div>
                  )}

                  <div className="grid grid-cols-10 gap-3">
                    <div className="col-span-4 lg:col-span-4">
                      <label className={labelCls}>Date of Apply</label>
                      <DateInput value={form.DateOfApply} onChange={(e) => setForm((f) => ({ ...f, DateOfApply: e.target.value }))} className={inputCls} />
                    </div>
                    <div className="col-span-3 lg:col-span-3">
                      <label className={labelCls}>Rate (₹/sqft) <span className="text-destructive">*</span></label>
                      <input type="number" value={form.RatePerSqFt} onChange={(e) => setForm((f) => ({ ...f, RatePerSqFt: e.target.value }))} className={inputCls} />
                    </div>
                    <div className="col-span-3 lg:col-span-3">
                      <label className={labelCls}>Est. Total Value</label>
                      <input type="text" readOnly value={computedTotal ? `₹${computedTotal.toLocaleString("en-IN")}` : "—"}
                        className={`${inputCls} bg-muted/30 text-muted-foreground`} />
                    </div>
                  </div>
                </div>

                {/* Right: everything the unit pick unlocks — GST preview,
                    Payment Plan, and Broker. */}
                <div className="space-y-4">
                  {/* Placeholder while the unit tree on the left is still
                      empty — keeps the widened dialog's right column from
                      reading as dead space and tells staff what will
                      appear here. */}
                  {!hasInventorySelection && (
                    <div className=" border border-dashed border-foreground/30 bg-card p-5 text-center space-y-1.5">
                      <div className="mx-auto w-9 h-9 bg-foreground/5 flex items-center justify-center">
                        <Building2 size={16} className="text-foreground" />
                      </div>
                      <p className="text-xs font-heading font-semibold text-foreground">Pick {isPlottedProject ? "plots" : "a unit"} to continue</p>
                      <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
                        Choose the company, project and {isPlottedProject ? "plots" : "unit"} on the left. GST breakdown,
                        payment plan and broker options will show up here.
                      </p>
                    </div>
                  )}

                  {/* GST preview — live from the moment a Rate is entered,
                      including any Parking already picked on Step 2 in this
                      same application, so staff see the real combined
                      bracket from the very start, not just at the very end. */}
                  {form.RatePerSqFt && computedTotal ? (
                    isPlottedProject ? <div className=" border border-foreground/30 bg-card p-4"><p className="text-xs font-semibold text-foreground">Land sale</p><p className="mt-1 text-[0.6875rem] text-muted-foreground">Selected plots are sold as land. GST is not applicable to this land value.</p></div>
                      : <GstBreakdownBox unitValue={computedTotal} parkingBase={detailParkingBase} />
                  ) : null}

                  {/* Payment Plan — mandatory the moment a unit is picked.
                      Options are this unit's own tagged plans (set in Unit
                      Master); if the unit has none tagged, every active plan
                      is offered instead. Not re-selectable on the Booking
                      page — this is the one place it's chosen. */}
                  {hasInventorySelection && form.PreferredPlotIds.length > 0 && (
                    <div className=" border border-border bg-muted/20 p-4">
                      <p className="text-xs font-semibold text-foreground">No payment plan</p>
                      <p className="mt-1 text-[0.6875rem] text-muted-foreground">A plot sale is paid as the Booking Amount entered on the payment step, then the balance. With no Booking Amount, the full value is due as one payment.</p>
                    </div>
                  )}
                  {hasInventorySelection && form.PreferredPlotIds.length === 0 && (
                    <div className=" border border-foreground/30 bg-card p-4 space-y-2">
                      <label className={labelCls}>Payment Plan <span className="text-destructive">*</span></label>
                      <select value={form.PaymentPlanId} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                        onChange={(e) => setForm((f) => ({ ...f, PaymentPlanId: e.target.value }))} className={inputCls}>
                        <option value="">Select a payment plan</option>
                        {applicablePaymentPlans.map((p: any) => (
                          <option key={p.Id} value={String(p.Id)}>{p.PlanName}</option>
                        ))}
                      </select>
                      {!unitTaggedPaymentPlans.length && blockTaggedPaymentPlans.length > 0 && (
                        <p className="text-[0.6875rem] text-muted-foreground">This unit has no payment plans of its own — showing its Block's tagged plans.</p>
                      )}
                      {!unitTaggedPaymentPlans.length && !blockTaggedPaymentPlans.length && projectTaggedPaymentPlans.length > 0 && (
                        <p className="text-[0.6875rem] text-muted-foreground">This unit's Block has no payment plans of its own — showing its Project's tagged plans.</p>
                      )}
                      {!unitTaggedPaymentPlans.length && !blockTaggedPaymentPlans.length && !projectTaggedPaymentPlans.length && (
                        <p className="text-[0.6875rem] text-muted-foreground">No payment plans tagged anywhere in this unit's hierarchy — showing every active plan instead.</p>
                      )}

                      {/* Brief plan breakdown — Booking is the plan's own
                          fixed ₹ (never a %), everything after it splits
                          100% of (Total Value - Booking) the same way
                          generateMilestonesForBooking computes it for a real
                          Booking. Purely a preview here — nothing is saved
                          until the actual Booking is created. */}
                      {selectedPaymentPlan && selectedPlanMilestones.length > 0 && (
                        <div className=" border border-foreground/30 bg-card px-3 py-2 space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Booking</span>
                            <span className="font-semibold text-foreground">₹{selectedPlanBookingAmount.toLocaleString("en-IN")}</span>
                          </div>
                          {selectedPlanMilestones.slice(1).map((m, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="truncate pr-2">{m.name} <span className="text-[0.625rem]">({m.pct}%)</span></span>
                              <span className="font-semibold text-foreground shrink-0">
                                {computedTotal ? `₹${Math.round((selectedPlanRemainder * m.pct) / 100).toLocaleString("en-IN")}` : "—"}
                              </span>
                            </div>
                          ))}
                          {!computedTotal && (
                            <p className="text-[0.625rem] text-muted-foreground pt-0.5">Enter Rate (₹/sqft) to see ₹ amounts for each step.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Broker — separate from Source/Channel Partner. A deal
                      can come from a Referral source AND still be brokered;
                      the two concepts are unrelated (see
                      CrmBrokerageMaster). The broker is introduced right
                      here, at Application time — always picked from Broker
                      Master (AccountHeadMaster, LHeadType=BR), never a fresh
                      Customer-level concept. His own identity (name/phone/
                      PAN/RERA) is never re-typed, only ever selected and
                      shown read-only. The ONLY editable field on this whole
                      block is the per-deal commission override % —
                      everything else is fetched, not entered. The rate here
                      is captured now but only becomes a real commission
                      schedule once Milestone #1 is paid
                      (maybeAutoCreateBrokerage), at which point it's split
                      into one tranche per payment milestone, each unlocking
                      as that milestone is paid — not a manual toggle here. */}
                  <div className=" border border-foreground/30 bg-card p-4 space-y-3">
                    <label className="flex items-center gap-2 text-xs font-heading font-semibold text-foreground">
                      <input type="checkbox" checked={form.ViaBroker}
                        onChange={(e) => setForm((f) => ({ ...f, ViaBroker: e.target.checked, ...(e.target.checked ? {} : { BrokerId: "", BrokerageRatePercent: "" }) }))} />
                      Via Broker
                    </label>
                    {form.ViaBroker && (
                      <div className="space-y-3">
                        <div>
                          <label className={labelCls}>Broker (from Broker Master)</label>
                          <SearchableSelect
                            value={form.BrokerId}
                            onChange={(v) => setForm((f) => ({ ...f, BrokerId: v }))}
                            placeholder="Select broker"
                            searchPlaceholder="Search brokers..."
                            options={(brokers as any[]).map((b: any) => ({ value: String(b.LHeadId), label: b.LHeadName }))}
                          />
                        </div>

                        {/* Read-only, auto-fetched from Broker Master the moment a
                            broker is on the form — mirrors the Supplier info card
                            pattern used on Purchase Orders (PurchaseOrderMaster.tsx).
                            Nothing in here is ever an editable input. */}
                        {selectedBroker && (
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-muted/20 border border-border p-3 text-sm">
                            {selectedBroker.LHeadPhone && (
                              <div>
                                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Phone</dt>
                                <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5"><Phone size={12} className="text-muted-foreground" />{selectedBroker.LHeadPhone}</dd>
                              </div>
                            )}
                            {selectedBroker.LHeadPan && (
                              <div>
                                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">PAN (Permanent Account Number)</dt>
                                <dd className="text-foreground font-heading tabular-nums text-xs font-medium mt-0.5 flex items-center gap-1.5"><IdCard size={12} className="text-muted-foreground" />{selectedBroker.LHeadPan}</dd>
                              </div>
                            )}
                            {selectedBroker.LHeadRera && (
                              <div>
                                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">RERA No.</dt>
                                <dd className="text-foreground font-heading tabular-nums text-xs font-medium mt-0.5 flex items-center gap-1.5"><FileBadge size={12} className="text-muted-foreground" />{selectedBroker.LHeadRera}</dd>
                              </div>
                            )}
                            {selectedBroker.LHeadPaymentTerms && (
                              <div>
                                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Payment Terms</dt>
                                <dd className="text-foreground font-medium mt-0.5">{selectedBroker.LHeadPaymentTerms}</dd>
                              </div>
                            )}
                          </dl>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className={labelCls}>Default Rate (Preview)</label>
                            <input readOnly value={`${brokerageTierDefault}% (< 1 Cr → 2%, ≥ 1 Cr → 1%)`}
                              className={`${inputCls} bg-muted/30 text-muted-foreground`} />
                          </div>
                          <div>
                            <label className={labelCls}>Commission Override %</label>
                            <input type="number" step="0.01" min="0" max="100" value={form.BrokerageRatePercent}
                              onChange={(e) => setForm((f) => ({ ...f, BrokerageRatePercent: e.target.value }))}
                              placeholder={String(brokerageTierDefault)} className={inputCls} />
                          </div>
                        </div>
                        <p className="text-[0.6875rem] text-muted-foreground -mt-1.5">
                          Only fill in the override if this specific deal needs a custom commission rate — otherwise the default above applies.
                        </p>

                        <div>
                          <label className={labelCls}>Payout Plan</label>
                          <select value={form.BrokeragePaymentPlan}
                            onChange={(e) => setForm((f) => ({ ...f, BrokeragePaymentPlan: e.target.value }))}
                            className={inputCls}>
                            <option value="OneTime">One-time — full commission once Booking Amount is paid</option>
                            <option value="TwoPart">Two-part — half on Booking Amount, half on Agreement Executed</option>
                            <option value="AgreementOnly">Agreement-only — full commission on Agreement Executed</option>
                          </select>
                        </div>

                        <p className="text-[0.6875rem] text-muted-foreground">
                          {form.BrokeragePaymentPlan === "TwoPart"
                            ? "Half the commission is released as soon as the Booking Amount is paid; the other half is held until the Agreement is Executed."
                            : form.BrokeragePaymentPlan === "AgreementOnly"
                            ? "The full commission is held until the Agreement is Executed — nothing is released at booking."
                            : "The full commission is released as soon as the Booking Amount is paid — no further tranches."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && applicationId != null && (
            <ParkingSelectionStep
              applicationId={applicationId}
              projectId={form.ProjectId}
              blockId={form.BlockId}
              computedTotal={computedTotal}
              canEdit={canEditUnitSelection}
              wizardAppStatus={wizardAppStatus}
            />
          )}

          {step === 3 && applicationId != null && (
            <ExtraWorkSelectionStep
              applicationId={applicationId}
              computedTotal={computedTotal}
              canEdit={canEditUnitSelection}
              wizardAppStatus={wizardAppStatus}
            />
          )}

          {step === 4 && applicationId != null && (
            <BankDetailsStep
              applicationId={applicationId}
              applicantName={selectedCustomer?.CustomerName || ""}
              applicantAddress={[selectedCustomer?.CurrentAddress, selectedCustomer?.CurrentCity, selectedCustomer?.CurrentState, selectedCustomer?.CurrentPincode].filter(Boolean).join(", ")}
              onRegisterSave={(fn) => { saveBankDetailsRef.current = fn; }}
            />
          )}

          {step === 5 && applicationId != null && (
            <CoApplicantStep
              applicationId={applicationId}
              applicantName={selectedCustomer?.CustomerName || ""}
              applicantAddress={selectedCustomer?.CurrentAddress || ""}
              applicantCity={selectedCustomer?.CurrentCity || ""}
              applicantState={selectedCustomer?.CurrentState || ""}
              applicantPincode={selectedCustomer?.CurrentPincode || ""}
            />
          )}

          {step === 6 && applicationId != null && (
            <AttachmentsStep applicationId={applicationId} />
          )}

          {step === 7 && (
            <div className="space-y-4">
              <div className=" border border-border bg-muted/20 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><User size={11} /> Assigned Sales Person</p>
                  <p className="font-medium text-foreground">{currentUser?.name || "—"} (you)</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><User size={11} /> Assigned By</p>
                  <p className="font-medium text-foreground">{currentUser?.name || "—"} (you)</p>
                </div>
              </div>

              {/* Unit, Parking, and the fixed HSN GST -> Amount -> Total
                  Amount — one single breakdown, not a separate mini-summary
                  repeating the same figures right above it. */}
              {selectedUnit && (
                <div className=" border border-border bg-muted/20 px-3 py-2 text-xs">
                  <p className="font-semibold text-foreground flex items-center gap-1.5 mb-1"><Building2 size={12} className="text-foreground" /> Unit & Price</p>
                  <p className="text-muted-foreground">{selectedUnit.UnitName} · {selectedUnit.UnitType || "—"} · {selectedUnit.AreaSqFt ? `${selectedUnit.AreaSqFt} sqft` : "—"}</p>
                </div>
              )}
              {isPlottedProject && selectedPlots.length > 0 && (
                <div className=" border border-border bg-muted/20 px-3 py-2 text-xs">
                  <p className="font-semibold text-foreground flex items-center gap-1.5 mb-1"><MapPin size={12} className="text-foreground" /> Plots & Price</p>
                  <p className="text-muted-foreground">{selectedPlots.map((plot: any) => plot.PlotName).join(", ")} · {selectedPlots.reduce((sum: number, plot: any) => sum + (Number(plot.AreaSqFt) || 0), 0).toLocaleString("en-IN")} sqft combined</p>
                </div>
              )}

              {hasInventorySelection && computedTotal > 0 && (
                isPlottedProject ? <div className=" border border-foreground/30 bg-card px-3 py-2 text-xs"><p className="font-semibold text-foreground">Land sale</p><p className="mt-0.5 text-muted-foreground">GST not applicable to the selected plot value.</p></div>
                  : <GstBreakdownBox unitValue={computedTotal} parkingBase={detailParkingBase} />
              )}

              {/* Extra Charges — separate from the Unit+Parking GST bracket
                  entirely (own fixed 18% HSN rate, never affects which
                  bracket Unit+Parking lands in), so it's its own summary
                  rather than folded into GstBreakdownBox above. */}
              {(detailExtraCharges as any[]).length > 0 && (
                <div className=" border border-border bg-muted/20 px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-foreground">Extra Charges</p>
                  {(detailExtraCharges as any[]).map((c: any) => (
                    <div key={c.Id} className="flex items-center justify-between text-muted-foreground">
                      <span className="truncate pr-2">{c.Description} <span className="text-[0.625rem]">(GST {c.GstRate}%)</span></span>
                      <span className="font-medium text-foreground shrink-0">₹{Number(c.TotalAmount).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-border pt-1 font-semibold text-foreground">
                    <span>Extra Charges Total</span>
                    <span>₹{detailExtraChargesTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              )}

              {/* Payment plan breakdown — identical math to the Step 1
                  preview (Booking is the plan's own fixed ₹, everything
                  after it splits 100% of Total - Booking). */}
              {selectedPaymentPlan && selectedPlanMilestones.length > 0 && (
                <div className=" border border-primary/20 bg-primary/5 px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-foreground">{selectedPaymentPlan.PlanName} — Payment Breakdown</p>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Booking</span>
                    <span className="font-semibold text-foreground">₹{selectedPlanBookingAmount.toLocaleString("en-IN")}</span>
                  </div>
                  {selectedPlanMilestones.slice(1).map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-muted-foreground">
                      <span className="truncate pr-2">{m.name} <span className="text-[0.625rem]">({m.pct}%)</span></span>
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
                  the bank picker can be project-scoped.

                  Locked (read-only-styled, disabled) once a figure is
                  already saved here — same Edit-to-unlock pattern as the
                  Project/Unit tree above, and for the same reason: this is
                  money already confirmed with the customer, not something
                  that should be one stray click away from being silently
                  overwritten every time the wizard is reopened. Stays
                  editable (Edit always available) through Draft/Pending;
                  once Approved, canEditUnitSelection goes false and the
                  Edit control disappears for good. */}
              <div className=" border border-border p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground block">Payment Details</label>
                  {applicationId != null && (
                    canEditUnitSelection ? (
                      paymentLocked && (
                        <button type="button" onClick={() => setPaymentLocked(false)}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Token Type</label>
                    <input type="text" value="Amount" readOnly disabled
                      title="Fixed — the Booking Amount is always a ₹ figure set by the Payment Plan, never a % staff pick here"
                      className={`${inputCls} bg-muted/30 text-muted-foreground cursor-not-allowed`} />
                  </div>
                  <div>
                    <label className={labelCls}>Token (Booking) Amount (₹)</label>
                    <input type="number" value={form.TokenValue} disabled={applicationId != null && (paymentLocked || !canEditUnitSelection)}
                      onChange={(e) => setForm((f) => ({ ...f, TokenValue: e.target.value }))}
                      placeholder={selectedPlanBookingAmount ? String(selectedPlanBookingAmount) : undefined}
                      className={inputCls} />
                    {selectedPlanBookingAmount > 0 && (
                      <p className="text-[0.6875rem] text-muted-foreground mt-1">
                        Defaults to the plan's fixed ₹{selectedPlanBookingAmount.toLocaleString("en-IN")} — change this only if the customer actually paid a different amount; anything over the fixed figure is auto-parked to On Account, not lost.
                      </p>
                    )}
                    <p className="text-[0.6875rem] text-muted-foreground mt-1">
                      This amount is held on the Booking record. A Money Receipt is auto-generated when the booking reaches the approval stage ("Verify &amp; Send for Approval") — Finance then approves it, after which it counts as paid.
                    </p>
                  </div>
                  <div>
                    <label className={labelCls}>Payment Mode</label>
                    <select value={form.PaymentMode} disabled={applicationId != null && (paymentLocked || !canEditUnitSelection)}
                      onChange={(e) => setForm((f) => ({ ...f, PaymentMode: e.target.value, ChequeNo: "", ChequeDate: "", TransactionRef: "" }))}
                      className={inputCls}>
                      <option value="">Select</option>
                      {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>

                  {/* Instrument reference — appears only once a non-Cash mode
                      is picked, since that's the only time there's actually
                      anything to reference. Cheque gets its own number/date
                      pair; every other non-Cash mode shares a single
                      Transaction Ref/UTR field, labeled per mode so it reads
                      naturally regardless of which one is picked. */}
                  {form.PaymentMode === "Cheque" && (
                    <>
                      <div>
                        <label className={labelCls}>Cheque Number</label>
                        <input type="text" value={form.ChequeNo} disabled={applicationId != null && (paymentLocked || !canEditUnitSelection)}
                          onChange={(e) => setForm((f) => ({ ...f, ChequeNo: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Cheque Date</label>
                        <DateInput value={form.ChequeDate} disabled={applicationId != null && (paymentLocked || !canEditUnitSelection)}
                          onChange={(e) => setForm((f) => ({ ...f, ChequeDate: e.target.value }))}
                          className={inputCls} />
                      </div>
                    </>
                  )}
                  {form.PaymentMode && form.PaymentMode !== "Cash" && form.PaymentMode !== "Cheque" && (
                    <div>
                      <label className={labelCls}>
                        {form.PaymentMode === "Home Loan" ? "Loan Disbursement Ref" : form.PaymentMode === "Other" ? "Reference / Details" : "Transaction Ref / UTR"}
                      </label>
                      <input type="text" value={form.TransactionRef} disabled={applicationId != null && (paymentLocked || !canEditUnitSelection)}
                        onChange={(e) => setForm((f) => ({ ...f, TransactionRef: e.target.value }))}
                        className={inputCls} />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className={labelCls}>Notes / Remarks</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={4} className={`${inputCls} resize-none`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Submitting creates the Booking immediately — there's no separate admin approval step. The
                payment plan, booking amount and payment itself are all handled on the Booking page from there.
                If the unit is unavailable at the moment of submit, the Application still saves as Pending and
                you can retry booking creation from the list.
              </p>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-3" style={{ borderTop: RULE }}>
            <button
              onClick={() => step > 1 && setStep(step === 3 && form.PreferredPlotIds.length ? 1 : step - 1)}
              disabled={step === 1}
              className={`${KEY_LINE} h-9 px-3`}>
              <ChevronLeft size={14} /> Back
            </button>
            <div className="flex gap-2">
              <button onClick={() => { setDialogOpen(false); resetWizard(); }}
                className={`${KEY_LINE} h-9 px-3`}>
                Cancel
              </button>
              {step === 1 && (
                <button onClick={handleCreateAndNext} disabled={saving}
                  className={`${KEY_INK} h-9 px-4`}>
                  {saving ? "Saving..." : "Next"} <ChevronRight size={14} />
                </button>
              )}
              {step === 2 && (
                <button onClick={() => advanceStep(3)}
                  className={`${KEY_INK} h-9 px-4`}>
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 3 && (
                <button onClick={() => advanceStep(4)}
                  className={`${KEY_INK} h-9 px-4`}>
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 4 && (
                <button onClick={handleBankDetailsNext} disabled={saving}
                  className={`${KEY_INK} h-9 px-4`}>
                  {saving ? "Saving..." : "Next"} <ChevronRight size={14} />
                </button>
              )}
              {step === 5 && (
                <button onClick={() => advanceStep(6)}
                  className={`${KEY_INK} h-9 px-4`}>
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 6 && (
                <button onClick={() => advanceStep(7)}
                  className={`${KEY_INK} h-9 px-4`}>
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 7 && (
                <button onClick={handleFinalSave} disabled={saving}
                  className={`${KEY_INK} h-9 px-4`}>
                  {saving ? "Submitting..." : hasBooking ? "Submit Edits" : "Submit Application"}
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Application detail — opened by clicking any row, in every stage
          tab (In Process/Converted/Not Converted). Read-only summary; the
          actions that actually change something (Resume, Approve/Reject,
          View Booking) stay on the row itself, not here. ── */}
      <Dialog open={viewingAppId != null} onOpenChange={(o) => { if (!o) closeApplication(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-none" style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              {viewingAppDetail ? (
                <>
                  <span className="font-heading tabular-nums text-primary">{viewingAppDetail.application.ApplicationNo}</span>
                  <span>— <ApplicantNames name={viewingAppDetail.application.ApplicantName} bookingId={viewingAppDetail.application.BookingId} applicationId={viewingAppDetail.application.ApplicationId} /></span>
                  {(() => { const s = viewingAppDetail.bookings?.length > 0 ? "Submitted" : viewingAppDetail.application.Status; return <SheetMark text={s} tone={appTone(s)} />; })()}
                </>
              ) : "Application Details"}
            </DialogTitle>
          </DialogHeader>
          {!viewingAppDetail ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (() => {
            const a = viewingAppDetail.application;
            const booking = (viewingAppDetail.bookings || [])[0];
            const isPlotSale = !!a.IsPlotSale;
            const unitArea = Number(isPlotSale ? a.PlotAreaSqFt : a.UnitAreaSqFt) || 0;
            const unitRate = Number(a.RatePerSqFt) || 0;
            const unitTotal = unitArea && unitRate ? Math.round(unitArea * unitRate) : 0;
            const parkingRows = viewingAppParking as any[];
            const parkingBase = parkingRows.reduce((s, p) => s + (Number(p.RateSnapshot) || 0) * (Number(p.Quantity) || 1), 0);
            // Land is outside GST, so a plot sale gets no Unit+Parking GST.
            const unitParkingGst = !isPlotSale && crmGstRates ? computeUnitParkingGst(unitTotal, parkingBase, crmGstRates) : null;
            const plan = (paymentPlans as any[]).find((p: any) => String(p.Id) === String(a.PaymentPlanId)) || null;
            const planMilestones = parseMilestones(plan?.MilestonesJson);
            const planBookingAmount = Number(plan?.BookingAmount || 0);
            const extraChargeRows = viewingAppExtraCharges as any[];
            const extraChargesTotal = extraChargeRows.reduce((s, c) => s + (Number(c.TotalAmount) || 0), 0);
            const grandTotal = (unitParkingGst?.total ?? (unitTotal + parkingBase)) + extraChargesTotal;
            const planRemainder = Math.max(0, grandTotal - planBookingAmount);

            // reusable mini row helper
            const Row = ({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) => (
              <div className={full ? "col-span-2" : ""}>
                <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                <p className="text-xs font-medium text-foreground leading-snug">{value || <span className="text-muted-foreground/60 font-normal">—</span>}</p>
              </div>
            );

            return (
              <div className="space-y-3 text-sm">

                {/* ── 1. Applicant ── */}
                <section className=" border border-border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                    <User size={13} className="text-foreground shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Applicant</span>
                    <span className="ml-auto font-heading tabular-nums text-[0.6875rem] text-muted-foreground">{a.CustomerNo || ""}</span>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    <Row label="Name" value={a.ApplicantName} />
                    <Row label="PAN (Permanent Account Number)" value={a.PanNo} />
                    <Row label="Mobile" value={<>{a.Mobile}{a.AltMobile ? <span className="text-muted-foreground"> / {a.AltMobile}</span> : null}</>} />
                    <Row label="Email" value={a.Email} />
                    <Row label="Address" full value={[a.CustomerAddress, a.CustomerCity, a.CustomerState, a.CustomerPincode].filter(Boolean).join(", ") || null} />
                  </div>
                  {(viewingAppCoApplicants as any[]).length > 0 && (
                    <div className="px-4 pb-3 pt-0 flex flex-wrap gap-2">
                      {(viewingAppCoApplicants as any[]).map((co: any) => (
                        <div key={co.Id} className="flex items-center gap-1.5 text-[0.6875rem] bg-muted/60 px-2.5 py-1">
                          <Users2 size={11} className="text-muted-foreground shrink-0" />
                          <span className="font-medium">{co.Name}</span>
                          {co.Relation && <span className="text-muted-foreground">· {co.Relation}</span>}
                          {co.Mobile && <span className="text-muted-foreground">· {co.Mobile}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── 2. Property ── */}
                <section className=" border border-border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                    <Building2 size={13} className="text-foreground shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Property</span>
                    {!!a.UnitUnavailableForBooking && (
                      <span className="ml-auto flex items-center gap-1 text-[0.6875rem] text-destructive"><XCircle size={11} /> Unit unavailable</span>
                    )}
                  </div>
                  <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    <Row label="Company" value={a.CompanyName} />
                    <Row label="Project" value={a.ProjectMasterName || a.InterestedProject} />
                    {isPlotSale ? (
                      <>
                        <Row label="Plots" value={a.PlotNames} />
                        <Row label="Area" value={unitArea ? `${unitArea.toLocaleString("en-IN")} sqft (land)` : null} />
                        <Row label="Rate" value={unitRate ? `₹${unitRate.toLocaleString("en-IN")}/sqft` : null} />
                        <Row label="Payment" value="Booking Amount, then the balance" />
                      </>
                    ) : (
                      <>
                        <Row label="Unit" value={a.PreferredUnitName || a.InterestedUnit} />
                        <Row label="Type / Area" value={
                          [a.PropertyType || a.BhkPreference || a.UnitTypeFromMaster, a.UnitAreaSqFt ? `${a.UnitAreaSqFt} sqft` : null].filter(Boolean).join(" · ") || null
                        } />
                        <Row label="Rate" value={unitRate ? `₹${unitRate.toLocaleString("en-IN")}/sqft` : null} />
                        <Row label="Payment Plan" value={a.PaymentPlanName} />
                      </>
                    )}
                  </div>
                  {/* Parking */}
                  {parkingRows.length > 0 && (
                    <div className="px-4 pb-3 flex flex-wrap gap-2">
                      {parkingRows.map((p: any) => (
                        <span key={p.Id} className="text-[0.6875rem] bg-muted/60 px-2.5 py-1 font-medium">
                          {p.CurrentParkingType}{p.SlotNo ? ` — Slot ${p.SlotNo}` : p.Quantity > 1 ? ` ×${p.Quantity}` : ""}
                          {" · "}₹{((Number(p.RateSnapshot) || 0) * (Number(p.Quantity) || 1)).toLocaleString("en-IN")}
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── 3. Financials (compact) ── */}
                <section className=" border border-border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                    <IndianRupee size={13} className="text-foreground shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Financials</span>
                    {grandTotal > 0 && (
                      <span className="ml-auto text-xs font-bold text-foreground">₹{grandTotal.toLocaleString("en-IN")}</span>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-1.5">
                    {unitTotal > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{isPlotSale ? `Land (${unitArea.toLocaleString("en-IN")} sqft, no GST)` : `Unit (${unitArea} sqft)`}</span>
                        <span className="font-medium">₹{unitTotal.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {parkingBase > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Parking</span>
                        <span className="font-medium">₹{parkingBase.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {extraChargesTotal > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Extra Charges</span>
                        <span className="font-medium">₹{extraChargesTotal.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {unitParkingGst && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>GST</span>
                        <span>₹{(unitParkingGst.total - unitTotal - parkingBase).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {grandTotal > 0 && (
                      <div className="flex justify-between text-xs font-semibold border-t border-border pt-1.5 mt-0.5">
                        <span>Total</span>
                        <span>₹{grandTotal.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {/* Payment plan milestone strip */}
                    {plan && planMilestones.length > 0 && grandTotal > 0 && (
                      <div className="pt-2 border-t border-border space-y-1">
                        <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Payment Schedule</p>
                        <div className="flex justify-between text-[0.6875rem]">
                          <span className="text-muted-foreground">Booking (fixed)</span>
                          <span className="font-medium">₹{planBookingAmount.toLocaleString("en-IN")}</span>
                        </div>
                        {planMilestones.slice(1).map((m, i) => (
                          <div key={i} className="flex justify-between text-[0.6875rem]">
                            <span className="text-muted-foreground truncate pr-2">{m.name} ({m.pct}%)</span>
                            <span className="font-medium shrink-0">₹{Math.round((planRemainder * m.pct) / 100).toLocaleString("en-IN")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Extra work detail */}
                    {extraChargeRows.length > 0 && (
                      <div className="pt-2 border-t border-border space-y-1">
                        <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Extra Charges</p>
                        {extraChargeRows.map((c: any) => (
                          <div key={c.Id} className="flex justify-between text-[0.6875rem]">
                            <span className="text-muted-foreground truncate pr-2">{c.Description}</span>
                            <span className="font-medium shrink-0">₹{Number(c.TotalAmount).toLocaleString("en-IN")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                {/* ── 4. Payment + Source in a 2-col row ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <section className=" border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                      <Wallet size={12} className="text-foreground shrink-0" />
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide">Token Payment</span>
                    </div>
                    <div className="px-3 py-2.5 space-y-2">
                      <Row label="Token" value={
                        a.TokenValue != null
                          ? a.TokenType === "Percentage"
                            ? `${a.TokenValue}% = ₹${Number(a.BookingAmount || 0).toLocaleString("en-IN")}`
                            : `₹${Number(a.TokenValue).toLocaleString("en-IN")} (Fixed)`
                          : null
                      } />
                      <Row label="Mode" value={a.PaymentMode} />
                      <Row label="Date" value={a.DateOfApply ? String(a.DateOfApply).slice(0, 10) : null} />
                    </div>
                  </section>

                  <section className=" border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                      <Briefcase size={12} className="text-foreground shrink-0" />
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide">Source</span>
                    </div>
                    <div className="px-3 py-2.5 space-y-2">
                      <Row label="Source" value={a.Source} />
                      <Row label="Assigned To" value={a.AssigneeName} />
                      {(a.PlatformName || a.CampaignName || a.ChannelPartnerName) && (
                        <Row label="Channel" value={[a.PlatformName, a.CampaignName, a.AdName].filter(Boolean).join(" › ") || a.ChannelPartnerName} />
                      )}
                    </div>
                  </section>
                </div>

                {/* ── 5. Broker (only if present) ── */}
                {a.BrokerName && (
                  <section className=" border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                      <Users2 size={13} className="text-foreground shrink-0" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Broker</span>
                    </div>
                    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                      <Row label="Broker" value={a.BrokerName} />
                      <Row label="Rate" value={a.BrokerageRatePercent != null ? `${a.BrokerageRatePercent}%` : null} />
                      {a.BrokeragePaymentPlan && a.BrokeragePaymentPlan !== "OneTime" && (
                        <Row label="Payout" value={a.BrokeragePaymentPlan === "TwoPart" ? "Two-part" : "Agreement-only"} />
                      )}
                    </div>
                  </section>
                )}

                {/* ── 6. Linked Booking ── */}
                {booking && (
                  <section className=" border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                      <FileText size={13} className="text-foreground shrink-0" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Linked Booking</span>
                      <button onClick={() => { closeApplication(); navigate(`/crm/bookings?applicationId=${a.Id}`); }}
                        className="ml-auto text-[0.6875rem] text-primary hover:underline flex items-center gap-0.5">
                        Open <ChevronRight size={11} />
                      </button>
                    </div>
                    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                      <Row label="Booking No" value={<span className="font-heading tabular-nums">{booking.BookingNo}</span>} />
                      <Row label="Status" value={booking.Status} />
                      <Row label="Unit" value={[booking.ProjectName, booking.UnitNo].filter(Boolean).join(" · ")} />
                      <Row label="Value" value={booking.TotalValue ? `₹${Number(booking.TotalValue).toLocaleString("en-IN")}` : null} />
                    </div>
                  </section>
                )}

                {/* ── 6b. Invoices (linked booking) ── */}
                {booking && (
                  <section className=" border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                      <FileText size={13} className="text-foreground shrink-0" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Invoices</span>
                      <a href={`/crm/invoices?bookingId=${booking.Id}`}
                        className="ml-auto text-[0.6875rem] text-primary hover:underline flex items-center gap-0.5">
                        Invoices page <ChevronRight size={11} />
                      </a>
                    </div>
                    <div className="px-4 py-3">
                      <CrmInvoiceList invoices={viewingAppInvoices as any[]} emptyText="No invoices yet for this booking." />
                    </div>
                  </section>
                )}

                {/* ── 7. Notes ── */}
                {a.Notes && (
                  <section className=" border border-border overflow-hidden">
                    <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide">Notes</span>
                    </div>
                    <p className="px-4 py-3 text-xs text-muted-foreground whitespace-pre-wrap">{a.Notes}</p>
                  </section>
                )}

                {/* ── 8. Status timeline ── */}
                {(viewingAppDetail.statusLog || []).length > 0 && (
                  <section className=" border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                      <Clock size={13} className="text-foreground shrink-0" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Timeline</span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {viewingAppDetail.statusLog.map((s: any, idx: number) => (
                        <div key={s.Id} className="flex items-start gap-2.5">
                          <div className="mt-1 shrink-0 w-1.5 h-1.5 bg-primary/60" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium">{s.FromStatus ? `${s.FromStatus} → ${s.ToStatus}` : s.ToStatus}</span>
                            {s.ActorName && <span className="text-[0.6875rem] text-muted-foreground"> · {s.ActorName}</span>}
                          </div>
                          <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
                            {s.CreatedAt ? fmtIstIso(s.CreatedAt) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

              </div>
            );
          })()}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => closeApplication()} className={`${KEY_LINE} h-9 px-3`}>
              Close
            </button>
            {viewingAppDetail && canCancelApplication(viewingAppDetail.application) && (
              <button
                onClick={() => { setCancellingApp(viewingAppDetail.application); setCancelRemarks(""); }}
                className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}
              >
                Cancel Application
              </button>
            )}
            {(canEditApplications || canRequestBookingCancellation) && viewingAppDetail?.application?.BookingId
              && viewingAppDetail.application.BookingStatus !== CrmStatus.CANCELLED
              && viewingAppDetail.application.DeedStatus !== "Registered" && (
              <button
                onClick={() => navigate(`/crm/cancellations?bookingId=${viewingAppDetail.application.BookingId}`)}
                className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}
              >
                Request Booking Cancellation
              </button>
            )}
            {viewingAppDetail?.application?.DeedStatus === "Registered" && (
              <span className="px-3 py-1.5 text-sm text-muted-foreground border border-border" title="Sale deed is Registered — title has legally transferred; standard cancellation is not applicable">
                Deed Registered — cancellation not applicable
              </span>
            )}
            {viewingAppDetail && canDeleteApplication(viewingAppDetail.application) && (
              <button
                onClick={() => handleDeleteApplication(viewingAppDetail.application)}
                className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}
              >
                Delete Application
              </button>
            )}
            {canEditApplications && viewingAppDetail && (isResumable(viewingAppDetail.application) || isEditableApplication(viewingAppDetail.application)) && (
              <button
                onClick={() => { const id = viewingAppDetail.application.Id; closeApplication(); setTimeout(() => loadApplicationIntoWizard(id), 180); }}
                disabled={loadingApplication}
                className={`${KEY_INK} h-9 px-4`}
              >
                {loadingApplication
                  ? "Loading..."
                  : isResumable(viewingAppDetail.application)
                    ? "Resume"
                    : viewingAppDetail.application.Status === CrmStatus.REJECTED
                      ? "Fix & Resubmit"
                      : "Edit Application"}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Plain div overlay — avoids nested Radix Dialog focus-trap conflict
          when Cancel is opened from inside the view dialog (same fix pattern
          as CoApplicant: two Radix Dialogs open at once freeze outer buttons). */}
      {cancellingApp && (
        <BodyPortal><div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setCancellingApp(null); setCancelRemarks(""); }}>
          <div className="bg-background border border-border w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold font-heading">Cancel Application?</h3>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-heading tabular-nums text-foreground">{cancellingApp?.ApplicationNo}</span> for{" "}
                <span className="font-medium text-foreground"><ApplicantNames name={cancellingApp?.ApplicantName} bookingId={cancellingApp?.BookingId} applicationId={cancellingApp?.ApplicationId} /></span> will be moved to Cancelled.
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
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setCancellingApp(null); setCancelRemarks(""); }}
                className={`${KEY_LINE} h-9 px-3`}
              >
                Keep Application
              </button>
              <button
                onClick={handleCancelApplication}
                disabled={cancelling}
                className={`${KEY_RED} h-9 px-4`}
              >
                {cancelling ? "Cancelling..." : "Cancel Application"}
              </button>
            </div>
          </div>
        </div></BodyPortal>
      )}
      {pdfDialogApp && (
        <ApplicationFormPdfDialog
          applicationId={pdfDialogApp.id}
          applicationNo={pdfDialogApp.no}
          onClose={() => setPdfDialogApp(null)}
        />
      )}
    </SheetShell>
    </>
  );
};

export default CrmApplication;
