import { panDisplay } from "@/lib/panDisplay";
import { CrmStatus, bookingWorkflowStageLabel, BOOKING_STAGE_REVIEW, isBookingClosed } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SentBackNote, useSentBack, useSentBackStates, SENT_BACK_STATE } from "@/components/crm/CrmListToolbar";
import { CorrectionBanner, checklistStep, useCorrections } from "./applications/config";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ChevronRight, CheckCircle2, Clock, XCircle, Building2, IdCard, ExternalLink, ChevronLeft, Trash2, FileText, User, Phone, FileBadge, MapPin, IndianRupee, Users2, Briefcase, PlayCircle, Ban, Lock, Wallet, AlertTriangle, MoreHorizontal, RefreshCw, Download } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApprovalActions } from "@/components/ApprovalActions";
import {
  CrmGrid, GridColumnChooser, GridSavedViews, GridSearch, GridTabs, exportGrid, useGridPrefs,
  GRID_BTN, GRID_CARD, GRID_KEY_BRAND, GRID_MENU_GLASS, GRID_PAGE_SIZES, GRID_SHEET_KEYS, GridStatusPill, type GridCol,
} from "@/components/crm/CrmDataTable";
const { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } = GRID_SHEET_KEYS;
import type { CrmSort } from "@/hooks/useCrmListState";
import { SentBackPanel } from "@/components/crm/CrmListToolbar";
import { Initials, asName } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { cn } from "@/lib/utils";
import { usePriceQuote, inr } from "@/lib/crmPriceQuote";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmInvoiceList } from "@/components/crm/CrmInvoiceList";
import { DateInput } from "@/components/ui/date-input";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { API, EMPTY_FORM, BANK_DETAIL_API, PARKING_API, EXTRA_CHARGE_API, CO_APPLICANT_API, PAY_MODES, STATUSES, appTone, fetchProjectBanks, fetchAllBanks, type ApplicationListFilters, fetchApplicationsList, fetchStageCounts, fetchFocusCounts, FOCUS_KEYS, type FocusKey, fetchAppDetail, STAGES, type Stage, stageLabel, fetchCustomers, fetchLeadOptions, fetchCompanies, fetchProjects, fetchUnits, fetchPlots, fetchBrokers, fetchPaymentPlans, fetchBlockPlanTags, type RateTier, fetchBrokerageRateTiers, inputCls, labelCls } from "./applications/config";
import { GstBreakdownBox, QuoteSchedule, gstReason } from "./applications/GstBreakdown";
import { CoApplicantStep } from "./applications/CoApplicantStep";
import { ApplicationFormPdfDialog } from "./applications/ApplicationFormPdfDialog";
import { BankDetailsStep } from "./applications/BankDetailsStep";
import { ParkingSelectionStep } from "./applications/ParkingSelectionStep";
import { ExtraWorkSelectionStep } from "./applications/ExtraWorkSelectionStep";
import { AttachmentsStep } from "./applications/AttachmentsStep";

import { useUrlParam } from "@/hooks/useUrlParam";
import { readCrmDraft, writeCrmDraft, clearCrmDraft } from "@/lib/crmDraftStore";
// The status filter's choices: the application's own statuses, then its booking sent back / resubmitted.
const SENT_BACK_FILTERS = ["SentBack", "Resubmitted"] as const;
const STATUS_FILTERS: readonly string[] = ["All", ...STATUSES, ...SENT_BACK_FILTERS];

const CrmApplication: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser, canDoAction } = useAuth();
  // Delete follows the page's Delete right (role rights, each user's own rights overriding), as the server does.
  const canDeleteApplications = canDoAction("crm-applications", "delete");
  const canEditApplications = canDoAction("crm-applications", "edit");
  const canCreateApplications = canDoAction("crm-applications", "create");
  const canRequestBookingCancellation = canDoAction("crm-cancellations", "create");
  const [searchInput, setSearchInput] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [search, setSearch] = useState("");
  // In the address too, so a refresh or a shared link keeps the filter; an unknown value reads as "All".
  const [statusFilter, setStatusFilter] = useUrlParam("status", "All", STATUS_FILTERS);
  // In the address, so a refresh or a shared link keeps it.
  const [activeStage, setActiveStage] = useUrlParam<Stage>("stage", "InProcess", STAGES);
  // What the In Process list is narrowed to (a needs-attention tile); in the address like the stage.
  const [focus, setFocus] = useUrlParam<FocusKey | "">("focus", "", ["", ...FOCUS_KEYS]);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const [sort, setSort] = useState<CrmSort>({ key: "CreatedAt", dir: "desc" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(1);
  const wizardStepsRef = useRef<HTMLDivElement>(null);
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
  // The unit change this application is for (crmApplications GET /:id): its Submit sends the unit change for approval.
  const [unitChange, setUnitChange] = useState<any>(null);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [applicationNo, setApplicationNo] = useState<string | null>(null);
  // Status of the application currently open in the wizard, as loaded from
  // the server (null while creating a brand-new one in step 1). Drives
  // whether the Project/Unit tree can be unlocked for editing at all — see
  // canEditUnitSelection below. Kept separate from `form` since it's never
  // itself an editable field.
  const [wizardAppStatus, setWizardAppStatus] = useState<string | null>(null);
  // Why the unit / plan can't change any more although the application could
  // (its booking is verified, or it's a plot sale whose plots can't swap) —
  // null while they can. Same rule the server applies (crmEntityCreation.applicationEditsClosedReason).
  const [bookingLockReason, setBookingLockReason] = useState<string | null>(null);
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

  // Keep the selected step in view when the step row scrolls horizontally on
  // small screens. The current-step summary below remains the readable label.
  useEffect(() => {
    if (!dialogOpen) return;
    const current = wizardStepsRef.current?.querySelector<HTMLElement>("[aria-current='step']");
    current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [dialogOpen, step]);

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

  const effectiveStatusFilter = activeStage === "Converted" ? "All" : statusFilter;
  const activeFocus = activeStage === "InProcess" ? focus : "";
  const listFilters: ApplicationListFilters = { search, status: effectiveStatusFilter, displayStage: activeStage, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId, sortKey: sort.key, sortDir: sort.dir, focus: activeFocus || undefined };
  const hasAppliedFilters = !!(search || effectiveStatusFilter !== "All" || cpb.companyId || cpb.projectId || cpb.blockId || activeFocus);
  const emptyQueueMessage = hasAppliedFilters
    ? "No applications match these filters. Clear filters or try a broader search."
    : activeStage === "Converted"
      ? "No converted applications yet."
      : activeStage === "NotConverted"
        ? "No rejected or cancelled applications yet."
        : "No applications in process yet.";
  const { data: listData, isLoading, isFetching, isError, error, refetch: refetchApplications } = useQuery({
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
    queryKey: ["crm-apps", "stage-counts", search, effectiveStatusFilter, cpb],
    queryFn: () => fetchStageCounts({ search, status: effectiveStatusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    placeholderData: (prev) => prev,
  });
  const { data: focusCounts } = useQuery({
    queryKey: ["crm-apps", "focus-counts", search, effectiveStatusFilter, cpb],
    queryFn: () => fetchFocusCounts({ search, status: effectiveStatusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    enabled: activeStage === "InProcess",
    placeholderData: (prev) => prev,
  });
  // Any filter change resets back to page 1 — otherwise a narrower result
  // set can strand the user on a page number that no longer exists.
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  const changeStage = (stage: Stage) => {
    updateFilter(setActiveStage)(stage);
    // Status filters apply to the application record. The Converted queue is
    // grouped by booking progress, so it must not inherit a hidden filter.
    if (stage === "Converted") setStatusFilter("All");
    if (stage !== "InProcess") setFocus("");
  };
  useEffect(() => {
    // Normalize shared links such as ?stage=Converted&status=Pending too.
    if (activeStage === "Converted" && statusFilter !== "All") setStatusFilter("All");
  }, [activeStage, statusFilter, setStatusFilter]);
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
  // The opened application's price, GST and schedule — from the server, the
  // same functions that price its booking (see the wizard's quote below).
  const viewingApp = viewingAppDetail?.application;
  const { data: viewingQuote } = usePriceQuote(viewingApp ? {
    unitIds: viewingApp.PreferredUnitIdsCsv ? String(viewingApp.PreferredUnitIdsCsv).split(",") : (viewingApp.PreferredUnitId != null ? [viewingApp.PreferredUnitId] : []),
    plotIds: viewingApp.PreferredPlotIdsCsv ? String(viewingApp.PreferredPlotIdsCsv).split(",") : [],
    ratePerSqFt: viewingApp.RatePerSqFt,
    parkingBases: (viewingAppParking as any[]).map((pk) => (Number(pk.RateSnapshot) || 0) * (Number(pk.Quantity) || 1)),
    extraAmounts: (viewingAppExtraCharges as any[]).map((c) => Number(c.Amount) || 0),
    paymentPlanId: viewingApp.PaymentPlanId,
    bookingAmount: viewingApp.BookingAmount ?? viewingApp.TokenValue,
    customerId: viewingApp.CustomerId,
  } : null);
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
  // The wizard's steps, in order — the tabs and the correction banner's links share them.
  const wizardStepLabels = [form.PreferredPlotIds.length ? "Project/Plots" : "Project/Unit", "Parking", "Extra Charges", "Bank/KYC", "Co-Applicant", "Attachments", "Details"];
  // Steps holding something Data Review flagged on this application (a mark on their tab).
  const { flags: correctionFlags } = useCorrections(applicationId);
  const flaggedSteps = new Set(correctionFlags.map((f: any) => checklistStep(f.ItemKey)));
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
  const hasSubmittedUnitChange = (app: any) => !!app?.UnitChangeStatus
    && !["Draft", "Completed", "Rejected", "Withdrawn"].includes(app.UnitChangeStatus);
  const isResumable = (app: any) => !!app && !hasSubmittedUnitChange(app) && app.Stage !== "Converted" && app.Status === CrmStatus.DRAFT;
  // Submitted (Pending) or reverted (Rejected) — booking may exist but not yet
  // approved by the next level. Editable until the booking reaches Approved;
  // if the booking is reverted (Rejected), also editable again.
  // Backend PUT /:id enforces the same gate server-side.
  const isEditableApplication = (app: any) =>
    !!app &&
    !hasSubmittedUnitChange(app) &&
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

  const canEditUnitSelection = !bookingLockReason && (wizardAppStatus === null || wizardAppStatus === CrmStatus.DRAFT || wizardAppStatus === CrmStatus.PENDING || wizardAppStatus === CrmStatus.REJECTED);

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
  const canCancelApplication = (app: any) => !!app && !hasSubmittedUnitChange(app) && canEditApplications && app.Stage !== "Converted" && !["Approved", "Cancelled", "Expired"].includes(app.Status);
  // Admin delete — only when no live booking exists (Stage !== Converted).
  // On a Converted application the booking is live and has real financial
  // history; the backend rejects deletes in that state, so don't offer the
  // button either (misleading to show a destructive action that will always fail).
  // Until its booking is fully approved; a not-yet-approved booking is deleted with it.
  const canDeleteApplication = (app: any) => !!app && !hasSubmittedUnitChange(app) && canDeleteApplications && !(app.Stage === "Converted" && app.BookingStatus === CrmStatus.APPROVED);

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

  const totalAreaSqFt = useMemo(() => (
    selectedPlots.length
      ? selectedPlots.reduce((sum: number, plot: any) => sum + (Number(plot.AreaSqFt) || 0), 0)
      : (units as any[]).filter((u: any) => form.PreferredUnitIds.includes(String(u.Id))).reduce((sum: number, u: any) => sum + (Number(u.AreaSqFt) || 0), 0)
  ), [units, form.PreferredUnitIds, selectedPlots]);
  const computedTotal = useMemo(() => {
    const rate = Number(form.RatePerSqFt) || 0;
    // To the paisa — the server's unitPrice rule, so this echo and the quote agree.
    return totalAreaSqFt && rate ? Math.round(totalAreaSqFt * rate * 100) / 100 : 0;
  }, [totalAreaSqFt, form.RatePerSqFt]);

  // Total Value can be typed directly instead of Rate — the rate is back-
  // calculated from it (Rate = Total ÷ Area) so staff who are quoted a flat
  // price don't have to do that division themselves. The field keeps its
  // own local text while focused (so typing isn't fought by the rounded
  // echo coming back through Rate → computedTotal) and only snaps to the
  // settled, rate-accurate total on blur or when the rate/unit changes from
  // elsewhere.
  const [totalValueInput, setTotalValueInput] = useState("");
  const totalFieldFocused = useRef(false);
  useEffect(() => {
    if (totalFieldFocused.current) return;
    setTotalValueInput(computedTotal ? String(computedTotal) : "");
  }, [computedTotal]);
  const handleTotalValueChange = (raw: string) => {
    setTotalValueInput(raw);
    if (!totalAreaSqFt) return;
    const total = Number(raw);
    if (!raw.trim() || !Number.isFinite(total) || total <= 0) return;
    // 4-decimal rate keeps the settled total (area × rate, shown on blur)
    // within a paise of what was typed — rounds away to nothing once
    // computedTotal rounds to the nearest rupee. 2 decimals wasn't enough
    // precision and visibly drifted the total by several rupees; raw
    // (unrounded) division also isn't used here since it can surface
    // floating-point noise like 1874.7238999999998 in the Rate field.
    const rate = Math.round((total / totalAreaSqFt) * 10000) / 10000;
    setForm((f) => ({ ...f, RatePerSqFt: String(rate) }));
  };
  // The price, GST and payment schedule, from the server — the same functions
  // that will price the booking (src/lib/crmPriceQuote.ts). Parking and extra
  // charges already picked on this application are included.
  const { data: quote, isFetching: quoteLoading } = usePriceQuote(hasInventorySelection ? {
    unitIds: form.PreferredUnitIds,
    plotIds: form.PreferredPlotIds,
    ratePerSqFt: form.RatePerSqFt || null,
    parkingBases: (detailParkingAllotments as any[]).map((pk) => (Number(pk.RateSnapshot) || 0) * (Number(pk.Quantity) || 1)),
    extraAmounts: (detailExtraCharges as any[]).map((c) => Number(c.Amount) || 0),
    paymentPlanId: form.PaymentPlanId || null,
    bookingAmount: form.TokenValue || null,
    customerId: form.CustomerId || null,
  } : null);

  // Brief, real-money preview of the plan actually picked — Booking is the
  // plan's own fixed ₹ (never a % — see CrmPaymentPlans.tsx), every
  // milestone after it splits 100% of (computedTotal - BookingAmount), same
  // math generateMilestonesForBooking uses once a real Booking exists.
  const selectedPaymentPlan = useMemo(() =>
    (paymentPlans as any[]).find((p: any) => String(p.Id) === form.PaymentPlanId) || null,
    [paymentPlans, form.PaymentPlanId]
  );
  const selectedPlanBookingAmount = Number(selectedPaymentPlan?.BookingAmount || 0);

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
    setBookingLockReason(null);
    setUnitLocked(false);
    setHasBooking(false);
    setUnitChange(null);
    setPaymentLocked(false);
  };

  // ── Wizard autosave ── Everything typed is kept as it is typed (per application, or "new" before step 1 creates the
  // record), whether or not Next/Submit was pressed, and offered back when the wizard reopens in this tab. It lives in
  // memory only (lib/crmDraftStore.ts): it holds PAN, Aadhaar, date of birth ..., which browser storage would keep in
  // clear text. A successful Submit clears it.
  const draftKey = (id: number | null) => `crm-app-draft:${id ?? "new"}`;
  const readDraft = (id: number | null): { form: typeof EMPTY_FORM; step: number; savedAt: number } | null => readCrmDraft(draftKey(id));
  const clearDraft = (id: number | null) => clearCrmDraft(draftKey(id));
  useEffect(() => {
    if (!dialogOpen) return;
    const t = setTimeout(() => {
      writeCrmDraft(draftKey(applicationId), { form, step, savedAt: Date.now() });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, form, step, applicationId]);
  // Once step 1 has created the record, the "new" draft lives on under its id.
  useEffect(() => { if (applicationId != null) clearDraft(null); }, [applicationId]);

  // `saved` is what the server already holds: a draft identical to it is not news.
  const offerDraft = (id: number | null, saved?: typeof EMPTY_FORM) => {
    const d = readDraft(id);
    if (!d?.form) return;
    const merged = { ...(saved || EMPTY_FORM), ...d.form };
    if (JSON.stringify(merged) === JSON.stringify(saved || EMPTY_FORM)) { clearDraft(id); return; }
    setForm((f) => ({ ...f, ...d.form }));
    if (id == null) setStep(1);
    toast.info("Unsaved entry restored", {
      action: { label: "Discard", onClick: () => { clearDraft(id); if (id == null) { setForm({ ...EMPTY_FORM }); } else { loadApplicationIntoWizard(id); } } },
    });
  };
  const openNewWizard = () => { resetWizard(); setDialogOpen(true); offerDraft(null); };

  // The open wizard lives in the URL (?edit=<id>&step=<n>, or ?new=1), so a
  // refresh or a shared link comes back to the same application and step.
  useEffect(() => {
    setSearchParams((sp) => {
      sp.delete("edit"); sp.delete("new"); sp.delete("step");
      if (dialogOpen) {
        if (applicationId != null) sp.set("edit", String(applicationId)); else sp.set("new", "1");
        sp.set("step", String(step));
      }
      return sp;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, applicationId, step]);
  const [wizardLinkOpened, setWizardLinkOpened] = useState(false);
  useEffect(() => {
    if (wizardLinkOpened) return;
    const edit = Number(searchParams.get("edit"));
    const wantStep = Number(searchParams.get("step")) || undefined;
    if (edit) { setWizardLinkOpened(true); loadApplicationIntoWizard(edit, wantStep); }
    else if (searchParams.get("new")) { setWizardLinkOpened(true); openNewWizard(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, wizardLinkOpened]);

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

  const loadApplicationIntoWizard = async (id: number, wantStep?: number) => {
    setLoadingApplication(true);
    try {
      const res = await fetchWithAuth(`${API}/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not load application");
      }
      const body = await res.json();
      const app = body.application;
      if (!app) throw new Error("Application record missing from response");
      if (body.unitChange && hasSubmittedUnitChange({ UnitChangeStatus: body.unitChange.Status })) {
        toast.info(`Unit change ${body.unitChange.RequestNo} is awaiting approval; its application is locked.`);
        navigate(`/crm/unit-changes?id=${body.unitChange.Id}`);
        return;
      }
      setHasBooking((body.bookings || []).length > 0);
      setUnitChange(body.unitChange || null);

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
      const loadedForm = {
        ...form,
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
      };
      setForm(loadedForm);
      setWizardAppStatus(app.Status || null);
      setBookingLockReason(!app.BookingId || isBookingClosed(app.BookingStatus) ? null
        : (app.BookingWorkflowStage && app.BookingWorkflowStage !== BOOKING_STAGE_REVIEW) || app.BookingReadyForApprovalAt
          ? `Booking ${app.BookingNo} is verified — reject it back to Data Review to change the unit or plan`
          : app.PreferredPlotIdsCsv ? `Booking ${app.BookingNo} is made — plots change by cancelling and re-booking` : null);

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
      // A plot sale has no Parking step (2): a link to it opens Extra Charges instead.
      const linked = wantStep === 2 && firstStepAfterProject === 3 ? 3 : wantStep;
      setStep(linked ? Math.min(resumeStep, Math.max(1, linked)) : resumeStep);
      setMaxStepReached(resumeStep);
      setDialogOpen(true);
      offerDraft(app.Id, loadedForm);
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
        if (!res.ok) throw new Error(data.error || "Could not save changes");
        setUnitLocked(true);
        toast.success("Property selection updated");
        window.dispatchEvent(new CustomEvent("approval-action"));
        // If saved parking no longer matches the property, warn before continuing.
        if (data.parkingWarning) toast.warning(data.parkingWarning, { duration: 12000 });
        if (form.PreferredUnitIds[0]) qc.invalidateQueries({ queryKey: ["unit-master"] });
        if (form.PreferredPlotIds.length) qc.invalidateQueries({ queryKey: ["plot-master"] });
        // Plot applications skip Parking just like a brand-new plot flow.
        advanceStep(form.PreferredPlotIds.length ? 3 : 2);
        return;
      }

      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CustomerId: parseInt(form.CustomerId), ...step1Fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create application");
      setApplicationId(data.id);
      setApplicationNo(data.ApplicationNo);
      setHasBooking(false);
    setUnitChange(null);
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
    // A changed item the verifier had ticked goes back to be verified — the booking and sent-back markers follow.
    window.dispatchEvent(new CustomEvent("approval-action"));
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
      clearDraft(applicationId);
      if (subData.unitChange) {
        // A unit change's application: sent for its approval; the new booking opens when it is approved. Straight to
        // the request (leaving the page closes the wizard; closing it first would put its own URL back).
        toast.success(subData.unitChange.message);
        ["crm-apps", "crm-unit-changes", "crm-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        navigate(`/crm/unit-changes?id=${subData.unitChange.id}`);
        return;
      }
      setDialogOpen(false);
      resetWizard();
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      qc.invalidateQueries({ queryKey: ["unit-master"] });
      // The server answers with bookingNo (crmApplications.js PUT /:id/submit); booking.BookingNo is the older shape.
      const newBookingNo = subData.bookingNo ?? subData.booking?.BookingNo;
      if (newBookingNo) {
          if (subData.booking?.alreadyExists) {
            toast.success("Application changes saved");
          } else {
            toast.success(`Booking ${newBookingNo} created — payment milestones auto-generated`);
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
  // Asked on the sheet (components/sheet/SheetAsk), in place of window.confirm.
  const ask = useSheetAsk();
  const requestConfirm = (msg: string, onOk: () => void) => { void ask.confirm(msg, { okLabel: "Delete", danger: true }).then((yes) => { if (yes) onOk(); }); };
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
      if (!res.ok) throw new Error(data.error || "Could not cancel application");
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
    requestConfirm(`Delete application ${a.ApplicationNo}? Its booking, if not yet fully approved, is deleted with it.`, async () => {
      try {
        const res = await fetchWithAuth(`${API}/${a.Id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not delete application");
        toast.success(data.message || "Application deleted");
        qc.invalidateQueries({ queryKey: ["crm-apps"] });
        qc.invalidateQueries({ queryKey: ["unit-master"] });
        qc.invalidateQueries({ queryKey: ["unit-matrix"] });
        qc.invalidateQueries({ queryKey: ["parking-matrix"] });
        if (viewingAppId === a.Id) closeApplication();
      } catch (e: any) {
        toast.error(translateError(e.message));
      }
    });
  };
  const handleCreateBooking = async (a: any) => {
    setCreatingBookingId(a.Id);
    try {
      const res = await fetchWithAuth(`${API}/${a.Id}/create-booking`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create booking");
      toast.success(`Booking ${data.booking?.BookingNo || "created"} — payment milestones auto-generated`);
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      qc.invalidateQueries({ queryKey: ["unit-master"] });
      qc.invalidateQueries({ queryKey: ["plot-master"] });
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      navigate(`/crm/bookings?applicationId=${a.Id}`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setCreatingBookingId(null);
    }
  };
  // Row actions and status, shared by the grid and the phone cards.
  const convertedActions = (r: any) => {
        const canRequestCxl = (canEditApplications || canRequestBookingCancellation) && r.BookingId
          && r.BookingStatus !== CrmStatus.CANCELLED && r.DeedStatus !== "Registered";
        return (
          <div className="flex items-center gap-1.5">
            {r.BookingId && <button type="button" onClick={() => navigate(`/crm/bookings?view=${r.BookingId}`)} className={`${KEY_LINE} h-7 px-2`}>
              <ExternalLink size={12} /> Open booking
            </button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label={`More actions for ${r.ApplicationNo || "this application"}`} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="More actions">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={cn("w-56", GRID_MENU_GLASS)}>
                <DropdownMenuItem onClick={() => openApplication(r.Id)} className="gap-2"><FileText size={14} /> View details</DropdownMenuItem>
              {r.Stage === "Converted" && (
                <DropdownMenuItem onClick={() => setPdfDialogApp({ id: r.Id, no: r.ApplicationNo })} className="gap-2"><FileText size={14} /> Application form (PDF)</DropdownMenuItem>
              )}
              {canRequestCxl && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate(`/crm/cancellations?bookingId=${r.BookingId}`)} className="gap-2 text-destructive focus:text-destructive">
                    <Ban size={14} /> Request cancellation
                  </DropdownMenuItem>
                </>
              )}
              {r.DeedStatus === "Registered" && (
                <DropdownMenuItem disabled className="gap-2" title="Sale deed is Registered — title has legally transferred; standard cancellation is not applicable">
                  <Ban size={14} /> Deed registered — no cancellation
                </DropdownMenuItem>
              )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
  };

  // Each application's booking sent back / resubmitted — for the row's Correct / Recheck button.
  const sentBackByApp = useSentBackStates("ApplicationId");
  // Correct opens the form at the first step Data Review flagged (or where it left off).
  const { data: sentBackData } = useSentBack();
  const firstCorrectionStep = (appId: number) => {
    const steps = ((sentBackData?.rows || []) as any[])
      .filter((r) => r.ApplicationId === appId && r.Kind === "review" && r.State === "SentBack")
      .map((r) => checklistStep(r.ItemKey));
    return steps.length ? Math.min(...steps) : undefined;
  };
  const statusCell = (r: any) => {
        // When a live Booking exists (Stage='Converted'), the Application's
        // DB Status is permanently 'Pending' — never updated, by design.
        // Displaying "Pending" here misleads staff into thinking the record
        // still needs attention. Show "Booked" instead so the conversion is
        // immediately visible without opening the detail panel.
        // Only an approved booking is "Booked"; until then it is still
        // working through the booking approvals.
        const displayStatus = r.Stage === "Converted"
          ? r.BookingStatus === CrmStatus.APPROVED ? "Booked" : "In Approval"
          : activeStage === "NotConverted" && r.BookingNo ? r.BookingStatus || "Booking closed" : r.Status;
        const hasPreferredInventory = !!(r.PreferredUnitId != null || r.PreferredUnitIdsCsv || r.PreferredPlotIdsCsv);
        return (
          // The pinned Status column is nowrap; the notes under the mark wrap.
          <div className="space-y-1 min-w-0 [&>span]:truncate [&>span]:max-w-[17rem]">
            <GridStatusPill status={displayStatus} />
            {/* For NotConverted applications that had a booking which was later
                cancelled/rejected — show the dead booking number so staff know
                this isn't the same as an application that was simply rejected
                pre-booking. */}
            {r.Stage === "NotConverted" && r.BookingNo && (
              <span className="block text-[0.625rem] text-muted-foreground font-heading tabular-nums">
                {r.BookingNo}
              </span>
            )}
            {/* Where it stands and what is next, beside the status itself. */}
            {activeStage === "InProcess" && r.Status === CrmStatus.PENDING && r.Stage !== "Converted" && r.UnitUnavailableForBooking && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-destructive"
                title="This application's picked unit is currently booked or held by a different application — re-pick a unit before a booking can be created.">
                <XCircle size={10} /> Unit unavailable — re-pick a unit
              </span>
            )}
            {activeStage === "InProcess" && r.Status === CrmStatus.DRAFT && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-foreground">
                <Clock size={10} /> Not submitted yet — complete the wizard and submit
              </span>
            )}
            {activeStage === "InProcess" && r.Status === CrmStatus.PENDING && r.Stage !== "Converted" && !hasPreferredInventory && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-foreground">
                <AlertTriangle size={10} /> Submitted but no property selected — edit to add one
              </span>
            )}
            {activeStage === "InProcess" && r.Status === CrmStatus.PENDING && r.Stage !== "Converted" && hasPreferredInventory && !r.UnitUnavailableForBooking && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                <Clock size={10} /> Submitted — booking not yet created
              </span>
            )}
            {/* Sent back for correction / resubmitted for a recheck (its booking's approval or data review). */}
            <SentBackNote applicationId={r.Id} />
            {activeStage === "InProcess" && r.Stage === "Converted" && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                <Clock size={10} /> Booking {r.BookingNo || ""} — {r.BookingStatus === CrmStatus.PENDING
                  ? `pending ${bookingWorkflowStageLabel[r.BookingWorkflowStage] || "approval"}`
                  : r.BookingStatus}
              </span>
            )}
            {activeStage !== "InProcess" && !canCancelApplication(r) && (
              <span className="text-[0.6875rem] text-muted-foreground">
                {r.BookingNo
                  ? `Booking ${r.BookingStatus || "closed"} — application closed`
                  : r.Status === "Converted"
                    ? "Its booking is no longer on this application — closed"
                    : `${r.Status} — no further action`}
              </span>
            )}
          </div>
        );
  };
  const inProcessActions = (a: any) => {
        const canResume = canEditApplications && activeStage === "InProcess" && isResumeEditable(a);
        // Put the next workflow action on the row; reserve the menu for
        // secondary actions such as viewing details, PDF, cancel, and delete.
        const resumeOnRow = canResume && isResumable(a);
        const editLabel = a.Status === CrmStatus.REJECTED ? "Fix & Resubmit" : "Edit";
        const canCreateBooking = canEditApplications && activeStage === "InProcess" && a.Status === CrmStatus.PENDING && a.Stage !== "Converted"
          && !a.UnitUnavailableForBooking && !!(a.PreferredUnitId != null || a.PreferredUnitIdsCsv || a.PreferredPlotIdsCsv) && !a.UnitChangeNo;
        const needsInventoryFix = activeStage === "InProcess" && a.Status === CrmStatus.PENDING && a.Stage !== "Converted"
          && (a.UnitUnavailableForBooking || !(a.PreferredUnitId != null || a.PreferredUnitIdsCsv || a.PreferredPlotIdsCsv));
        const canFixInventory = canResume && needsInventoryFix;
        const hasMenu = (canResume && !resumeOnRow && !canFixInventory) || a.Stage === "Converted"
          || canCancelApplication(a) || canDeleteApplication(a);
        // Sent back: the preparer corrects it in the form; resubmitted: the checker looks at the booking again.
        const sb = sentBackByApp.get(a.Id);
        return (
          <div className="flex items-center justify-end gap-1.5">
            <div className="flex items-center gap-1.5">
              {sb === "SentBack" && canEditApplications && (
                <button onClick={() => loadApplicationIntoWizard(a.Id, firstCorrectionStep(a.Id))} disabled={loadingApplication} className={`${KEY_INK} h-7 px-2`}>
                  Correct <ChevronRight size={11} />
                </button>
              )}
              {sb === "Reapprove" && a.BookingId && (
                <button onClick={() => navigate(`/crm/bookings?view=${a.BookingId}`)} className={`${KEY_LINE} h-7 px-2`} title="Yours to approve again, or send back — on the booking">
                  Re-approve <ChevronRight size={11} />
                </button>
              )}
              {sb === "Resubmitted" && a.BookingId && (
                <button onClick={() => navigate(`/crm/bookings?view=${a.BookingId}`)} className={`${KEY_LINE} h-7 px-2`}>
                  Recheck <ChevronRight size={11} />
                </button>
              )}
              {resumeOnRow && (
                <button onClick={() => loadApplicationIntoWizard(a.Id)} disabled={loadingApplication} className={`${KEY_INK} h-7 px-2`}>
                  <PlayCircle size={12} /> {loadingApplication ? "Loading…" : "Resume"}
                </button>
              )}
              {canFixInventory && (
                <button onClick={() => loadApplicationIntoWizard(a.Id, 1)} disabled={loadingApplication} className={`${KEY_INK} h-7 px-2`}>
                  <Building2 size={12} /> {loadingApplication ? "Loading…" : a.UnitUnavailableForBooking ? "Change unit" : "Choose property"}
                </button>
              )}
              {activeStage === "InProcess" && a.Stage === "Converted" && a.BookingId && (
                <button onClick={() => navigate(`/crm/bookings?view=${a.BookingId}`)} className={`${KEY_LINE} h-7 px-2`}>
                  <ExternalLink size={12} /> Open booking
                </button>
              )}
              {canCreateBooking && (
                <button onClick={() => handleCreateBooking(a)} disabled={creatingBookingId === a.Id}
                  className={`${KEY_INK} h-7 px-2`}>
                  <Building2 size={12} /> {creatingBookingId === a.Id ? "Creating…" : "Create booking"}
                </button>
              )}
              {/* Legacy only: a Rejected application from old data gets its resubmit. */}
              {activeStage === "InProcess" && (
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
              )}
              {hasMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label={`More actions for ${a.ApplicationNo || "this application"}`} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="More actions">
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className={cn("w-56", GRID_MENU_GLASS)}>
                    <DropdownMenuItem onClick={() => openApplication(a.Id)} className="gap-2"><FileText size={14} /> View details</DropdownMenuItem>
                    {canResume && !resumeOnRow && (
                      <DropdownMenuItem onClick={() => loadApplicationIntoWizard(a.Id)} disabled={loadingApplication} className="gap-2">
                        <PlayCircle size={14} /> {editLabel}
                      </DropdownMenuItem>
                    )}
                    {/* Application Form PDF — only once a live booking exists (backend enforces the same gate). */}
                    {a.Stage === "Converted" && (
                      <DropdownMenuItem onClick={() => setPdfDialogApp({ id: a.Id, no: a.ApplicationNo })} className="gap-2">
                        <FileText size={14} /> Application form (PDF)
                      </DropdownMenuItem>
                    )}
                    {(canCancelApplication(a) || canDeleteApplication(a)) && <DropdownMenuSeparator />}
                    {canCancelApplication(a) && (
                      <DropdownMenuItem onClick={() => { setCancellingApp(a); setCancelRemarks(""); }} className="gap-2 text-destructive focus:text-destructive">
                        <Ban size={14} /> Cancel application
                      </DropdownMenuItem>
                    )}
                    {canDeleteApplication(a) && (
                      <DropdownMenuItem onClick={() => handleDeleteApplication(a)} className="gap-2 text-destructive focus:text-destructive">
                        <Trash2 size={14} /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        );
  };
  const rowActions = (a: any) => (activeStage === "Converted" ? convertedActions(a) : inProcessActions(a));

  // Phone cards use a sales workflow hierarchy instead of turning every
  // desktop table column (campaign, source, etc.) into an equal-weight field.
  // The existing action cell is passed through so role-gated actions stay in
  // one place and behave identically in both layouts.
  const renderMobileApplicationCard = (a: any) => {
    const actionContent = rowActions(a);
    const hasBooking = a.Stage === "Converted";
    const hasBookingRecord = hasBooking || !!a.BookingNo;
    const hasPreferredInventory = !!(a.PreferredUnitId != null || a.PreferredUnitIdsCsv || a.PreferredPlotIdsCsv);
    const displayStatus = hasBooking
      ? a.BookingStatus === CrmStatus.APPROVED ? "Booked" : "In approval"
      : activeStage === "NotConverted" && a.BookingNo ? a.BookingStatus || "Booking closed" : a.Status;
    const project = hasBookingRecord ? a.BookingProjectName : a.InterestedProject;
    const property = hasBookingRecord
      ? a.BookingUnitNo
      : [a.BhkPreference, a.PropertyType].filter(Boolean).join(" · ") || a.UnitTypeFromMaster;
    const value = hasBookingRecord ? a.BookingGrandTotal ?? a.BookingTotalValue : null;
    const applicationDate = a.DateOfApply || a.CreatedAt;

    return (
      <article key={`application-card-${a.Id}`} className="rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={() => openApplication(a.Id)} className="font-heading text-sm font-semibold text-primary hover:underline text-left">
              {a.ApplicationNo || "Application"}
            </button>
            <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
              {applicationDate ? `Applied ${String(applicationDate).slice(0, 10)}` : "Application"}
              {a.UnitChangeNo ? ` · Unit change ${a.UnitChangeNo}` : ""}
            </p>
          </div>
          <SheetMark text={displayStatus || "—"} tone={appTone(displayStatus)} />
        </div>

        <div className="mt-3">
          <button type="button" onClick={() => openApplication(a.Id)} className="block text-left w-full text-sm font-semibold text-foreground">
            <ApplicantNames name={a.ApplicantName} bookingId={a.BookingId} applicationId={a.ApplicationId} />
          </button>
          {a.Mobile
            ? <span className="block text-xs text-muted-foreground mt-0.5">{a.Mobile}</span>
            : <span className="block text-xs text-muted-foreground mt-0.5">No mobile on file</span>}
        </div>

        <div className="mt-3 pt-3 border-t border-border/70 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 text-xs">
          <div className="min-w-0">
            <span className="block text-[0.625rem] uppercase tracking-wider text-muted-foreground">{hasBookingRecord ? "Booking" : "Interested in"}</span>
            <span className="block mt-0.5 text-foreground font-medium truncate">
              {hasBookingRecord ? a.BookingNo || "Booking in progress" : project || "Project not selected"}
              {property ? ` · ${property}` : ""}
            </span>
            {hasBookingRecord && a.BookingDate && <span className="block mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">Booked {String(a.BookingDate).slice(0, 10)}</span>}
          </div>
          {value != null && <div className="shrink-0 text-right">
            <span className="block text-[0.625rem] uppercase tracking-wider text-muted-foreground">Booking value</span>
            <span className="block mt-0.5 font-semibold text-foreground tabular-nums">{Number(value) ? `₹${Number(value).toLocaleString("en-IN")}` : "—"}</span>
          </div>}
          {!hasBooking && <div className="w-full text-[0.6875rem] text-muted-foreground">Assigned to {a.AssigneeName || "Unassigned"}</div>}
        </div>

        {activeStage === "InProcess" && a.Status === CrmStatus.PENDING && !hasBooking && (
          <p className={`mt-2 text-[0.6875rem] ${a.UnitUnavailableForBooking ? "text-destructive" : "text-muted-foreground"}`}>
            {a.UnitUnavailableForBooking ? "Unit unavailable · re-pick a unit" : !hasPreferredInventory ? "No property selected · edit application" : "Submitted · booking not yet created"}
          </p>
        )}
        {hasBooking && a.BookingStatus !== CrmStatus.APPROVED && (
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">{a.BookingNo ? `${a.BookingNo} · ` : ""}Pending {bookingWorkflowStageLabel[a.BookingWorkflowStage] || "approval"}</p>
        )}
        <SentBackNote applicationId={a.Id} />

        {actionContent && <div className="mt-3 pt-3 border-t border-border/70 flex justify-end">{actionContent}</div>}
      </article>
    );
  };

  // ── The list: the Bookings grid — sortable on the server, columns chosen / ordered / sized per viewer, saved
  // views, Excel export of every matching row, and phone cards. ──────────────────────────────────────────────────
  const hasBookingRecord = (a: any) => a.Stage === "Converted" || !!a.BookingNo;
  const appValue = (a: any) => (hasBookingRecord(a) ? Number(a.BookingGrandTotal ?? a.BookingTotalValue) || 0 : 0);
  const appProperty = (a: any) => hasBookingRecord(a)
    ? { project: a.BookingProjectName, unit: a.BookingUnitNo }
    : { project: a.InterestedProject || a.ProjectMasterName, unit: a.PlotNames || a.PreferredUnitName || [a.BhkPreference, a.PropertyType].filter(Boolean).join(" · ") || a.UnitTypeFromMaster };
  const appDate = (a: any) => (a.DateOfApply || a.CreatedAt ? String(a.DateOfApply || a.CreatedAt).slice(0, 10) : "");
  const COLS: GridCol<any>[] = [
    { id: "application", label: "Application", sortKey: "ApplicationNo", locked: true, csv: (a) => a.ApplicationNo,
      cell: (a) => (
        <div>
          <div className="text-xs font-semibold tabular-nums text-foreground">{a.ApplicationNo}</div>
          {a.UnitChangeNo && <div className="text-[0.6875rem] font-medium text-sky-700 dark:text-sky-400 whitespace-nowrap">Unit change {a.UnitChangeNo}</div>}
          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{appDate(a) || "—"}</div>
        </div>
      ) },
    { id: "applied", label: "Applied on", sortKey: "CreatedAt", hiddenByDefault: true, csv: appDate,
      cell: (a) => <span className="text-xs tabular-nums">{appDate(a) || "—"}</span> },
    { id: "applicant", label: "Applicant", sortKey: "Applicant", csv: (a) => a.ApplicantName,
      cell: (a) => (
        <div className="flex items-center gap-2.5 min-w-0 md:w-[10.5rem] 2xl:w-[12.5rem] whitespace-normal">
          <Initials name={a.ApplicantName} />
          <div className="min-w-0">
            <div className="font-semibold text-foreground line-clamp-2 break-words capitalize">
              <ApplicantNames name={asName(a.ApplicantName)} bookingId={a.BookingId} applicationId={a.Id} />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">{a.Mobile || "No mobile on file"}</div>
          </div>
        </div>
      ) },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (a) => a.Mobile,
      cell: (a) => <span className="text-xs tabular-nums">{a.Mobile || "—"}</span> },
    { id: "property", label: "Property", sortKey: "Project",
      csv: (a) => { const p = appProperty(a); return [p.project, p.unit].filter(Boolean).join(" / "); },
      cell: (a) => {
        const p = appProperty(a);
        return (
          <div className="min-w-0 md:max-w-[9rem] 2xl:max-w-[11rem]" title={[p.project, p.unit].filter(Boolean).join(" / ")}>
            <div className="truncate">{p.project || "—"}</div>
            <div className="text-xs text-muted-foreground truncate">
              {[p.unit, !hasBookingRecord(a) && a.RatePerSqFt ? `₹${Number(a.RatePerSqFt).toLocaleString("en-IN")}/sqft` : null].filter(Boolean).join(" · ") || "Property not selected"}
            </div>
          </div>
        );
      } },
    { id: "booking", label: "Booking", sortKey: "Booking", csv: (a) => a.BookingNo || "",
      cell: (a) => a.BookingNo ? (
        <div className="space-y-0.5">
          <div className="text-xs font-semibold tabular-nums">{a.BookingNo}</div>
          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{a.BookingDate ? String(a.BookingDate).slice(0, 10) : "—"}</div>
        </div>
      ) : <span className="text-xs text-muted-foreground">—</span> },
    { id: "value", label: "Value", sortKey: "Value", align: "right", csv: (a) => appValue(a) || "",
      cell: (a) => {
        const v = appValue(a);
        if (!v) return <span className="text-muted-foreground">—</span>;
        const cleared = Number(a.BookingCleared) || 0;
        const pct = Math.min(100, Math.round((cleared / v) * 100));
        return (
          <div className="space-y-1 min-w-[7.5rem] text-right">
            <div className="font-semibold tabular-nums">{fmtShort(v)}</div>
            <div className="h-1.5 w-full rounded-full overflow-hidden bg-muted" role="img" aria-label={`${fmtShort(cleared)} cleared of ${fmtShort(v)}`}>
              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[0.625rem] text-muted-foreground tabular-nums">{fmtShort(cleared)} cleared · {pct}%</div>
          </div>
        );
      } },
    { id: "assignee", label: "Assigned to", sortKey: "Assignee", csv: (a) => a.AssigneeName || "",
      cell: (a) => <span className="text-xs">{a.AssigneeName || <span className="text-muted-foreground">Unassigned</span>}</span> },
    { id: "source", label: "Source", hiddenByDefault: true, csv: (a) => [a.Source, a.CampaignName, a.ChannelPartnerName].filter(Boolean).join(" · "),
      cell: (a) => <span className="text-xs">{[a.Source, a.CampaignName, a.ChannelPartnerName].filter(Boolean).join(" · ") || "—"}</span> },
    { id: "plan", label: "Payment plan", hiddenByDefault: true, csv: (a) => a.PaymentPlanName || "",
      cell: (a) => <span className="text-xs">{a.PaymentPlanName || "—"}</span> },
    { id: "status", label: "Status", sortKey: "Status", csv: (a) => a.Status,
      cell: (a) => <div className="min-w-[11rem] max-w-[16rem]">{statusCell(a)}</div> },
    { id: "next", label: "Next", locked: true,
      cell: (a) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>{rowActions(a)}</div> },
  ];
  const [prefs, setPrefs] = useGridPrefs("crm-applications-cols", COLS);
  const rights = usePageRights("crm-applications");
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let p = 1; ; p++) {
        const r = await fetchApplicationsList(listFilters, p, 200);
        rows.push(...r.rows);
        if (rows.length >= r.total || !r.rows.length) break;
      }
      exportGrid(rows, COLS.filter((c) => c.locked || !prefs.hidden.includes(c.id)), "applications");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setExporting(false);
    }
  };
  const clearFilters = () => { setSearchInput(""); setSearch(""); setStatusFilter("All"); setFocus(""); setCpb({ companyId: "", projectId: "", blockId: "" }); setPage(1); };
  // The In Process queue's needs-attention tiles: each counts every matching application and narrows the list to it.
  const FOCUS_TILES: { key: FocusKey; label: string; hint: string; tone: string }[] = [
    { key: "draft", label: "Not submitted", hint: "Complete the wizard and submit", tone: "bg-slate-400" },
    { key: "noProperty", label: "No property selected", hint: "Edit to add a unit or plot", tone: "bg-amber-500" },
    { key: "unitUnavailable", label: "Unit unavailable", hint: "Re-pick a unit", tone: "bg-red-500" },
    { key: "readyToBook", label: "Ready to book", hint: "Submitted — booking not yet created", tone: "bg-primary" },
    { key: "inApproval", label: "Booking in approval", hint: "Data Review, Marketing Head, Director", tone: "bg-sky-500" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Applications"]} />
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CivilierERP · CRM</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">Applications</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Create applications, track their progress, and continue unfinished work from the queue.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => qc.invalidateQueries({ queryKey: ["crm-apps"] })} disabled={isFetching}
              className={cn(GRID_BTN, "w-9 !px-0")} title="Refresh" aria-label="Refresh">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
            {canCreateApplications && <button type="button" onClick={openNewWizard} className={cn(GRID_KEY_BRAND, "h-9 px-3")}><Plus size={13} /> New application</button>}
            <span aria-live="polite" aria-atomic="true" className="ml-1 text-xs text-muted-foreground tabular-nums">
              {total.toLocaleString("en-IN")} {hasAppliedFilters ? (total === 1 ? "match" : "matches") : (total === 1 ? "application" : "applications")}
            </span>
          </div>
        </section>
        {/* This page's entries sent back / resubmitted. */}
        <SentBackPanel />

        <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
          <GridTabs label="Application queues" active={activeStage} onChange={(k) => changeStage(k)}
            tabs={STAGES.map((stg) => ({ key: stg, label: stageLabel[stg], count: stageCounts[stg] }))} />
          {activeStage === "InProcess" && (
            <div role="group" aria-label="Needs attention" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 px-3 py-3 border-b border-border bg-muted/30">
              {FOCUS_TILES.map((t) => {
                const on = focus === t.key;
                const n = focusCounts?.[t.key];
                return (
                  <button key={t.key} type="button" aria-pressed={on} onClick={() => { setFocus(on ? "" : t.key); setPage(1); }}
                    className={cn("text-left rounded-lg border px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      on ? "border-primary bg-primary/[0.07] shadow-sm" : "border-border bg-card hover:border-foreground/25", n === 0 && !on && "opacity-60")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className={cn("h-2 w-2 rounded-full", t.tone)} />{t.label}</span>
                      <span className="text-lg font-semibold tabular-nums leading-none">{n ?? "–"}</span>
                    </span>
                    <span className="block mt-1 text-[0.6875rem] text-muted-foreground truncate">{on ? "Showing these · tap to show all" : t.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
            <GridSearch value={searchInput} onChange={setSearchInput} placeholder="Search name, mobile, application no…" />
            {activeStage !== "Converted" && (
              <Select value={statusFilter} onValueChange={updateFilter(setStatusFilter)}>
                <SelectTrigger className="w-auto min-w-[150px] h-8 rounded-md text-xs" aria-label="Status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  {/* Its booking sent back for an update, or resubmitted for a recheck. */}
                  {SENT_BACK_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>{SENT_BACK_STATE[s].label} — {SENT_BACK_STATE[s].note}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
            {hasAppliedFilters && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
            <div className="ml-auto flex items-center gap-2">
              <GridSavedViews storageKey="crm-applications-views"
                current={{ status: statusFilter, search: searchInput.trim(), cpb, sort, pageSize }}
                onApply={(v) => {
                  setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                  setStatusFilter((STATUS_FILTERS.includes(v.status) ? v.status : "All") as typeof statusFilter);
                  setSearchInput(v.search || ""); setSearch(v.search || "");
                  setCpb(v.cpb || { companyId: "", projectId: "", blockId: "" });
                  if (v.sort) setSort(v.sort);
                  setPage(1);
                }} />
              <GridColumnChooser cols={COLS} prefs={prefs} onChange={setPrefs} />
              {rights.canExport && <button type="button" onClick={handleExport} disabled={exporting || !total} className={GRID_BTN} title="Export to Excel">
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>}
            </div>
          </div>
          <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={apps} rowKey={(a: any) => a.Id} noRowNumbers mobileCardRenderer={renderMobileApplicationCard}
            loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message || "Could not load applications.") : null} onRetry={() => refetchApplications()}
            sort={sort} onSort={(k) => { setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" })); setPage(1); }}
            onRowClick={(a: any) => openApplication(a.Id)} activeKey={viewingAppId}
            empty={emptyQueueMessage}
            page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
        </div>
      </div>

      {/* New Application Dialog — 5-step wizard: what the customer is
          applying for (unit/parking/KYC/docs). No money changes hands or
          gets recorded here — that's entirely the Booking page's job. */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetWizard(); } }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 gap-4 rounded-xl">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">
              {/* An existing one (resumed draft, or Edit / Fix & Resubmit) has its number: not "new". */}
              <Building2 size={14} /> {applicationNo ? "Application" : "New application"}
              {applicationNo ? <span className="text-muted-foreground font-medium tabular-nums normal-case tracking-normal text-sm">· {applicationNo}</span> : null}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator — each tab is clickable navigation to any step
              already reached (maxStepReached), so staff can jump straight
              back to e.g. Co-Applicant without walking Next through Parking
              and Bank/KYC again. A step beyond what's been reached yet isn't
              clickable — steps 2-6 all need applicationId (created in step 1)
              and Bank/KYC intentionally still gates via its own Next/Save. */}
          <div ref={wizardStepsRef} className="flex items-stretch overflow-x-auto overflow-y-hidden" role="group" aria-label="Application steps" style={{ border: RULE }}>
            {wizardStepLabels.map((label, i) => {
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
                    aria-current={step === stepNum ? "step" : undefined}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${
                      step === stepNum
                        ? "bg-foreground text-card"
                        : step > stepNum ? "text-foreground" : "text-muted-foreground"
                    } ${reachable ? "cursor-pointer hover:bg-primary/10" : "cursor-not-allowed opacity-50"}`}
                    style={{ borderRight: RULE_SOFT }}>
                    {step > stepNum ? <CheckCircle2 size={12} /> : <span className="w-4 text-center">{form.PreferredPlotIds.length && stepNum > 2 ? stepNum - 1 : stepNum}</span>}
                    {label}
                    {/* Data Review flagged something on this step. */}
                    {flaggedSteps.has(stepNum) && <span className="w-1.5 h-1.5 bg-destructive" title="Flagged in Data Review — correct it here" />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/20 border-x border-b border-border">
            <p className="text-xs font-medium text-foreground">Step {form.PreferredPlotIds.length && step > 2 ? step - 1 : step} of {form.PreferredPlotIds.length ? wizardStepLabels.length - 1 : wizardStepLabels.length}: {wizardStepLabels[step - 1]}</p>
            <p className="text-[0.6875rem] text-muted-foreground">Complete this section, then select <span className="font-medium text-foreground">Next</span>.</p>
          </div>

          {/* What Data Review / booking approval sent back, on the step that holds it. */}
          <CorrectionBanner applicationId={applicationId} step={step} stepLabels={wizardStepLabels} onJump={(n) => setStep(n)} />
          {unitChange && (
            <div className="border border-sky-500/30 bg-sky-500/[0.06] px-3 py-2.5 text-xs space-y-1">
              <p className="font-semibold text-foreground flex flex-wrap items-center gap-x-2">
                Unit change {unitChange.RequestNo}
                <span className="font-normal text-muted-foreground">from booking {unitChange.SourceBookingNo}{unitChange.SourceUnitNo ? ` · ${unitChange.SourceUnitNo}` : ""} · {unitChange.Status}</span>
                <button type="button" onClick={() => { setDialogOpen(false); resetWizard(); navigate(`/crm/unit-changes?id=${unitChange.Id}`); }} className="ml-auto text-primary hover:underline font-medium">Open request</button>
              </p>
              <p className="text-muted-foreground">
                {unitChange.Status === "Draft"
                  ? `This is the buyer's application for the new unit. The unit's rate is filled in as a starting point; agree and enter the final rate here, then set the payment plan, parking and extra charges. Submit it to send the unit change for approval. There is no separate unit-change fee; any amount due follows the new payment plan.`
                  : `This unit change is ${unitChange.Status}: the new booking opens when it is approved.`}
              </p>
            </div>
          )}

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
                  searchPlaceholder="Search name, mobile or customer no…"
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
                          <Lock size={11} /> {bookingLockReason || `Locked (${wizardAppStatus})`}
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
                        searchPlaceholder="Search projects…"
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
                            searchPlaceholder="Search plots…"
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
                      {form.RatePerSqFt && quote ? (
                        <span>
                          {quote.areaSqFt.toLocaleString("en-IN")} sqft × ₹{Number(form.RatePerSqFt).toLocaleString("en-IN")}/sqft = <span className="font-semibold text-foreground">{inr(quote.unitValue)}</span>
                        </span>
                      ) : (
                        <span>Enter Rate (₹/sqft) to see the full price.</span>
                      )}
                    </div>
                  )}
                  {isPlottedProject && selectedPlots.length > 0 && (
                    <div className=" border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
                      <IndianRupee size={11} className="text-foreground shrink-0" />
                      {form.RatePerSqFt && quote ? (
                        <span>{selectedPlots.length} plot{selectedPlots.length === 1 ? "" : "s"} · {quote.areaSqFt.toLocaleString("en-IN")} sqft × ₹{Number(form.RatePerSqFt).toLocaleString("en-IN")}/sqft = <span className="font-semibold text-foreground">{inr(quote.unitValue)}</span></span>
                      ) : <span>Enter Rate (₹/sqft) to see the combined plot price.</span>}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-10 gap-3">
                    <div className="col-span-1 sm:col-span-4">
                      <label className={labelCls}>Date of Apply</label>
                      <DateInput value={form.DateOfApply} onChange={(e) => setForm((f) => ({ ...f, DateOfApply: e.target.value }))} className={inputCls} />
                    </div>
                    <div className="col-span-1 sm:col-span-3">
                      <label className={labelCls}>Rate (₹/sqft) <span className="text-destructive">*</span></label>
                      <input type="number" value={form.RatePerSqFt} onChange={(e) => setForm((f) => ({ ...f, RatePerSqFt: e.target.value }))} className={inputCls} />
                    </div>
                    <div className="col-span-1 sm:col-span-3">
                      <label className={labelCls}>Total Value</label>
                      <input type="text" inputMode="decimal" disabled={!totalAreaSqFt} value={totalValueInput}
                        onFocus={() => { totalFieldFocused.current = true; }}
                        onBlur={() => { totalFieldFocused.current = false; setTotalValueInput(computedTotal ? String(computedTotal) : ""); }}
                        onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) handleTotalValueChange(e.target.value); }}
                        className={`${inputCls} disabled:bg-muted/30 disabled:text-muted-foreground`} />
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
                  {hasInventorySelection && form.RatePerSqFt ? <GstBreakdownBox quote={quote} loading={quoteLoading} /> : null}

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

                      {/* The schedule this plan gives at this price — the
                          server's split, the same one the booking stores. */}
                      {selectedPaymentPlan && <QuoteSchedule quote={quote} />}
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
                            searchPlaceholder="Search brokers…"
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
                                <dd className="text-foreground font-heading tabular-nums text-xs font-medium mt-0.5 flex items-center gap-1.5"><IdCard size={12} className="text-muted-foreground" />{panDisplay(selectedBroker.LHeadPan)}</dd>
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
              quote={quote}
              quoteLoading={quoteLoading}
              canEdit={canEditUnitSelection}
              wizardAppStatus={wizardAppStatus}
            />
          )}

          {step === 3 && applicationId != null && (
            <ExtraWorkSelectionStep
              applicationId={applicationId}
              quote={quote}
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

              {hasInventorySelection && <GstBreakdownBox quote={quote} loading={quoteLoading} />}

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

              {/* The payment schedule at this price — the server's split. */}
              <QuoteSchedule quote={quote} title={selectedPaymentPlan ? `${selectedPaymentPlan.PlanName} — Payment Breakdown` : "Payment Breakdown"}
                className="border border-primary/20 bg-primary/5 px-3 py-2 text-xs space-y-1" />

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
              {!unitChange && <div className=" border border-border p-3 space-y-2.5">
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
                        <Lock size={11} /> {bookingLockReason || `Locked (${wizardAppStatus})`}
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
              </div>}

              <div>
                <label className={labelCls}>Notes / Remarks</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={4} className={`${inputCls} resize-none`} />
              </div>
              {unitChange ? (
                <p className="text-xs text-muted-foreground">
                  Submitting sends unit change {unitChange.RequestNo} for approval. On approval the new booking opens with this rate,
                  payment plan, parking and extra charges. Booking {unitChange.SourceBookingNo} then closes; moving received money follows the linked change process.
                </p>
              ) : <p className="text-xs text-muted-foreground">
                Submitting creates the Booking immediately — there's no separate admin approval step. The
                payment plan, booking amount and payment itself are all handled on the Booking page from there.
                If the unit is unavailable at the moment of submit, the Application still saves as Pending and
                you can retry booking creation from the list.
              </p>}
            </div>
          )}

          <div className="sticky bottom-0 z-20 flex justify-between gap-2 pt-3 pb-1 bg-background" style={{ borderTop: RULE }}>
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
                  {saving ? "Saving…" : "Next"} <ChevronRight size={14} />
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
                  {saving ? "Saving…" : "Next"} <ChevronRight size={14} />
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
                  {saving ? "Submitting…" : unitChange ? "Send Unit Change for Approval" : hasBooking ? "Submit Edits" : "Submit Application"}
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
        <DialogContent className="w-[96vw] max-w-6xl max-h-[92vh] overflow-y-auto rounded-xl p-0 gap-0">
          <DialogHeader className="sticky top-0 z-10 bg-background px-6 pt-5 pb-4 border-b border-border">
            <DialogTitle className="font-heading flex flex-wrap items-center gap-2 text-lg pr-8">
              {viewingAppDetail ? (
                <>
                  <span className="font-heading tabular-nums text-primary">{viewingAppDetail.application.ApplicationNo}</span>
                  <span>— <ApplicantNames name={viewingAppDetail.application.ApplicantName} bookingId={viewingAppDetail.application.BookingId} applicationId={viewingAppDetail.application.ApplicationId} /></span>
                  {(() => { const s = viewingAppDetail.bookings?.length > 0 ? "Submitted" : viewingAppDetail.application.Status; return <SheetMark text={s} tone={appTone(s)} />; })()}
                </>
              ) : "Application Details"}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5">
          {!viewingAppDetail ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (() => {
            const a = viewingAppDetail.application;
            const booking = (viewingAppDetail.bookings || [])[0];
            const isPlotSale = !!a.IsPlotSale;
            const unitArea = viewingQuote?.areaSqFt ?? (Number(isPlotSale ? a.PlotAreaSqFt : a.UnitAreaSqFt) || 0);
            const parkingRows = viewingAppParking as any[];
            const unitRate = Number(a.RatePerSqFt) || 0;
            // Every money figure below is the server's quote (viewingQuote).
            const vq = viewingQuote;
            const unitTotal = vq?.unitValue ?? 0;
            const parkingBase = vq?.parkingBase ?? 0;
            const plan = (paymentPlans as any[]).find((p: any) => String(p.Id) === String(a.PaymentPlanId)) || null;
            const extraChargeRows = viewingAppExtraCharges as any[];
            const extraChargesTotal = vq?.extraChargesTotal ?? 0;
            const grandTotal = vq?.grandTotal ?? 0;

            // reusable mini row helper
            const Row = ({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) => (
              <div className={full ? "col-span-2" : ""}>
                <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                <p className="text-xs font-medium text-foreground leading-snug">{value || <span className="text-muted-foreground/60 font-normal">—</span>}</p>
              </div>
            );

            return (
              <div className="space-y-4 text-sm">

                {/* ── At a glance ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 border border-border divide-x divide-border bg-muted/20">
                  {[
                    { label: isPlotSale ? "Plots" : "Unit", value: isPlotSale ? a.PlotNames : (a.PreferredUnitName || a.InterestedUnit) },
                    { label: "Project", value: a.ProjectMasterName || a.InterestedProject },
                    { label: "Payment Plan", value: isPlotSale ? "Booking, then balance" : a.PaymentPlanName },
                    { label: "Total Value", value: grandTotal > 0 ? `₹${grandTotal.toLocaleString("en-IN")}` : null },
                  ].map((k) => (
                    <div key={k.label} className="px-4 py-3 min-w-0">
                      <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
                      <p className="text-sm font-semibold truncate tabular-nums">{k.value || <span className="text-muted-foreground/60 font-normal">—</span>}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
                <div className="lg:col-span-3 space-y-4 min-w-0">

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

                </div>

                {/* Right column: money and history */}
                <div className="lg:col-span-2 space-y-4 min-w-0 lg:sticky lg:top-0">
                {/* ── 3. Financials (compact) ── */}
                <section className=" border border-border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                    <IndianRupee size={13} className="text-foreground shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Financials</span>
                    {grandTotal > 0 && (
                      <span className="ml-auto text-sm font-bold text-foreground tabular-nums">₹{grandTotal.toLocaleString("en-IN")}</span>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-1.5 tabular-nums">
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
                    {vq && vq.totalGstAmount > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>GST</span>
                        <span>{inr(vq.totalGstAmount)}</span>
                      </div>
                    )}
                    {grandTotal > 0 && (
                      <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-1">
                        <span>Total</span>
                        <span>₹{grandTotal.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {vq && <p className="text-[0.625rem] text-muted-foreground">{gstReason(vq)}</p>}
                    {/* Payment schedule at this price — the server's split. */}
                    <QuoteSchedule quote={vq} title={`Payment Schedule${plan?.PlanName || a.PaymentPlanName ? ` · ${plan?.PlanName || a.PaymentPlanName}` : ""}`}
                      className="pt-3 mt-1 border-t border-border space-y-1 text-xs [&>p:first-child]:text-[0.625rem] [&>p:first-child]:uppercase [&>p:first-child]:tracking-wide [&>p:first-child]:text-muted-foreground [&>p:first-child]:font-normal" />
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
                </div>

              </div>
            );
          })()}
          </div>
          <div className="sticky bottom-0 z-10 bg-background flex flex-wrap items-center justify-end gap-2 px-6 py-3 border-t border-border">
            <button onClick={() => closeApplication()} className={`${KEY_LINE} h-9 px-3 mr-auto`}>
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
                  ? "Loading…"
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

      {/* A real dialog layered over the view dialog (elevated): a body-level
          overlay sat outside the open view dialog, which blocks typing and
          clicks there. */}
      <Dialog open={!!cancellingApp} onOpenChange={(o) => { if (!o) { setCancellingApp(null); setCancelRemarks(""); } }}>
        <DialogContent hideCloseButton elevated className="max-w-md rounded-xl space-y-4">
            <DialogHeader><DialogTitle className="text-base font-semibold font-heading">Cancel Application?</DialogTitle></DialogHeader>
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
                  placeholder="e.g. Applied by mistake, customer changed their mind…"
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
                {cancelling ? "Cancelling…" : "Cancel Application"}
              </button>
            </div>
        </DialogContent>
      </Dialog>
      {pdfDialogApp && (
        <ApplicationFormPdfDialog
          applicationId={pdfDialogApp.id}
          applicationNo={pdfDialogApp.no}
          onClose={() => setPdfDialogApp(null)}
        />
      )}
      {ask.node}
    </>
  );
};

export default CrmApplication;
