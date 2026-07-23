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
const PARKING_MASTER_API = "/api/parking-master";
const PARKING_SLOT_API = "/api/parking-slot-master";

const STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Cancelled"];
// Mirrors SaLead.SourceType so lead source values stay consistent across the whole system
const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];
const DOC_TYPES = ["IdentityProof", "AddressProof", "PhotoID", "IncomeProof", "Other"];

const statusColor: Record<string, string> = {
  Draft:     "text-muted-foreground bg-muted/50 border-border",
  Pending:   "text-blue-600 bg-blue-50 border-blue-200",
  Approved:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-orange-600 bg-orange-50 border-orange-200",
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
};

const EMPTY_BANK = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  NomineeName: "", NomineeRelation: "", NomineeDob: "", NomineeContact: "", NomineeAddress: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "",
};

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
async function fetchParkingMaster(): Promise<any[]> {
  try { const r = await fetchWithAuth(PARKING_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchParkingSlots(): Promise<any[]> {
  try { const r = await fetchWithAuth(PARKING_SLOT_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchPaymentPlans(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/crm/payment-plans"); return r.ok ? r.json() : []; } catch { return []; }
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
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [loadingApplication, setLoadingApplication] = useState(false);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [applicationNo, setApplicationNo] = useState<string | null>(null);
  // Locked once a source chain is auto-fetched from the customer's linked
  // lead — "Change" lets staff override it for the (rarer) case the
  // customer's actual source for THIS application differs from their
  // original lead's source. Unlocked by default for customers with no
  // linked lead, since there is nothing to auto-fetch.
  const [sourceLocked, setSourceLocked] = useState(false);
  // Locked once a Payment Plan is auto-fetched from the selected Unit's own
  // default (Unit Master decides this up front) — "Change" lets staff pick
  // a different plan for the (rarer) deal that genuinely needs one. No plan
  // to lock if the unit has no default set.
  const [planLocked, setPlanLocked] = useState(false);
  const [invoiceRow, setInvoiceRow] = useState<any | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ Amount: "", InvoiceType: "Booking", InvoiceDate: "", Description: "" });
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
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
  const { data: customers = [] } = useQuery({ queryKey: ["crm-customers-dropdown"], queryFn: fetchCustomers, staleTime: 60_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-dropdown"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });
  const { data: companies = [] } = useQuery({ queryKey: ["crm-companies-dropdown"], queryFn: fetchCompanies, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: platforms = [] } = useQuery({ queryKey: ["sa-platforms"], queryFn: fetchPlatforms, staleTime: 5 * 60_000 });
  const { data: campaigns = [] } = useQuery({ queryKey: ["sa-campaigns-dropdown"], queryFn: fetchCampaigns, staleTime: 5 * 60_000 });
  const { data: ads = [] } = useQuery({ queryKey: ["sa-ads-dropdown"], queryFn: fetchAds, staleTime: 5 * 60_000 });
  const { data: channelPartners = [] } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchChannelPartners, staleTime: 5 * 60_000 });
  const { data: brokers = [] } = useQuery({ queryKey: ["crm-brokers-dropdown"], queryFn: fetchBrokers, staleTime: 5 * 60_000 });
  const { data: parkingRates = [] } = useQuery({ queryKey: ["parking-master"], queryFn: fetchParkingMaster, staleTime: 5 * 60_000 });
  const { data: parkingSlots = [] } = useQuery({ queryKey: ["parking-slot-master"], queryFn: fetchParkingSlots, staleTime: 5 * 60_000 });
  const { data: paymentPlans = [] } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchPaymentPlans, staleTime: 5 * 60_000 });

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
    return (units as any[]).filter((u: any) => String(u.ProjectId) === form.ProjectId);
  }, [units, form.ProjectId]);
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
  const applicablePaymentPlans = useMemo(() => {
    return (paymentPlans as any[]).filter((p: any) => {
      if (!p.IsActive) return false;
      if (p.CompanyId && String(p.CompanyId) !== form.CompanyId) return false;
      if (p.ProjectId && String(p.ProjectId) !== form.ProjectId) return false;
      if (p.BlockId && String(p.BlockId) !== form.BlockId) return false;
      if (p.UnitId && String(p.UnitId) !== form.PreferredUnitId) return false;
      return true;
    });
  }, [paymentPlans, form.CompanyId, form.ProjectId, form.BlockId, form.PreferredUnitId]);

  // Resume is only meaningful for a genuinely incomplete application — and
  // Status='Draft' is now that exact, authoritative signal (Step 1 of the
  // wizard creates the record as Draft; it only flips to Pending once Step 4
  // actually submits it — see crmEntityCreation.js / crmApplications.js
  // PUT /:id/submit). This used to be guessed from which form fields
  // happened to be empty, which was fragile in both directions: a fully
  // submitted Pending application with a blank (optional) Notes field would
  // incorrectly show Resume, while other field combinations could just as
  // easily fail to show it on a genuinely incomplete one. Status is the
  // real answer; stop guessing.
  const isResumeEditable = (app: any) => !!app && app.Status === "Draft";

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

  // Which unit's Payment Plan the user has explicitly clicked "Change" on —
  // mirrors sourceUnlockedForCustomerRef so a background units refetch
  // (same data, new array identity) never silently re-locks and clobbers
  // the override.
  const planUnlockedForUnitRef = useRef<number | null>(null);

  // The moment a unit with a Default Payment Plan is selected, auto-fetch
  // it onto the application and lock it — the plan was already decided at
  // Unit Master setup time, not something staff should re-pick per deal.
  useEffect(() => {
    const unitId = selectedUnit?.Id ?? null;
    if (applicationId) return;
    if (!unitId) {
      setPlanLocked(false);
      setForm((f) => (f.PaymentPlanId ? { ...f, PaymentPlanId: "" } : f));
      return;
    }
    if (!selectedUnit?.DefaultPaymentPlanId) {
      setPlanLocked(false);
      setForm((f) => (f.PaymentPlanId ? { ...f, PaymentPlanId: "" } : f));
      return;
    }
    if (planUnlockedForUnitRef.current === unitId) return;
    setForm((f) => ({ ...f, PaymentPlanId: String(selectedUnit.DefaultPaymentPlanId) }));
    setPlanLocked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, selectedUnit?.Id, selectedUnit?.DefaultPaymentPlanId]);

  const computedTotal = useMemo(() => {
    const area = Number(selectedUnit?.AreaSqFt) || 0;
    const rate = Number(form.RatePerSqFt) || 0;
    return area && rate ? Math.round(area * rate) : 0;
  }, [selectedUnit, form.RatePerSqFt]);

  // Preview only — under 1Cr -> 2%, 1Cr and above -> 1%. The real, final
  // percentage/amount is computed server-side off the Booking's actual
  // TotalValue once one exists (see maybeAutoCreateBrokerage in
  // crmWorkflowGuards.js); this just gives staff a rate hint at intake time.
  const brokerageTierDefault = computedTotal >= 10000000 ? 1 : 2;

  const resetWizard = () => {
    setForm({ ...EMPTY_FORM });
    setStep(1);
    setApplicationId(null);
    setApplicationNo(null);
    // Lock flag/unlock-guard is gated on the form that's about to be blown
    // away — leaving it set would leak into the next customer picked in a
    // freshly-opened wizard (e.g. a stale "unlocked" guard suppressing the
    // auto-fetch for a customer who never actually clicked "Change").
    setSourceLocked(false);
    sourceUnlockedForCustomerRef.current = null;
    setPlanLocked(false);
    planUnlockedForUnitRef.current = null;
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
      }));
      setSourceLocked(!!app.Source && !!app.PlatformId);
      setPlanLocked(!!app.PaymentPlanId);
      planUnlockedForUnitRef.current = null;

      const hasProject = !!app.CompanyId && !!app.ProjectId && !!app.PreferredUnitId;
      setStep(hasProject ? 2 : 1);
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
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CustomerId: parseInt(form.CustomerId),
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create application");
      setApplicationId(data.id);
      setApplicationNo(data.ApplicationNo);
      toast.success(`Application ${data.ApplicationNo} created`);
      setStep(2);
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

  const handleBankDetailsNext = async () => {
    setSaving(true);
    try {
      await saveBankDetailsRef.current?.();
      setStep(4);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalSave = async () => {
    setSaving(true);
    try {
      await saveApplicationFields({ Notes: form.Notes || null });
      // Actually submits the application — this is what triggers the 72h
      // auto-hold on the picked Unit/Parking server-side (see crmApplications.js
      // PUT /:id/submit). Before this call the wizard only ever PUT individual
      // step fields; nothing marked the application as "fully filed."
      const subRes = await fetchWithAuth(`${API}/${applicationId}/submit`, { method: "PUT" });
      if (!subRes.ok) { const d = await subRes.json().catch(() => ({})); throw new Error(d.error || "Submit failed"); }
      toast.success("Application submitted — unit/parking held for 72 hours, pending admin approval");
      setDialogOpen(false);
      resetWizard();
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
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

  const convertedColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ApplicationNo", header: "App No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Applicant", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium text-foreground">{i.row.original.ApplicantName}</div>
          {i.row.original.LeadUid && <div className="text-xs text-muted-foreground">Lead: {i.row.original.LeadUid}</div>}
        </div>
      ) },
    { accessorKey: "Mobile", header: "Mobile", size: 110, cell: (i) => <span className="text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "BookingNo", header: "Booking", size: 140,
      cell: (i) => (
        <div>
          <div className="font-mono text-xs font-semibold text-foreground">{i.row.original.BookingNo}</div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-green-600 bg-green-50 border-green-200">{i.row.original.BookingStatus}</span>
        </div>
      ) },
    { id: "unitProject", header: "Unit / Project", size: 140, enableSorting: false,
      cell: (i) => <span className="text-xs">{[i.row.original.BookingProjectName, i.row.original.BookingUnitNo].filter(Boolean).join(" · ") || "—"}</span> },
    { accessorKey: "BookingTotalValue", header: "Value", size: 110,
      cell: (i) => {
        const val = i.row.original.BookingGrandTotal ?? i.row.original.BookingTotalValue;
        return <span className="text-xs font-medium">{val ? `₹${Number(val).toLocaleString("en-IN")}` : "—"}</span>;
      } },
    { accessorKey: "BookingDate", header: "Booked On", size: 110,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.BookingDate ? String(i.row.original.BookingDate).slice(0, 10) : "—"}</span> },
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
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Applicant", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium text-foreground">{i.row.original.ApplicantName}</div>
          {i.row.original.LeadUid && <div className="text-xs text-muted-foreground">Lead: {i.row.original.LeadUid}</div>}
        </div>
      ) },
    { accessorKey: "Mobile", header: "Mobile", size: 100, cell: (i) => <span className="text-muted-foreground">{i.getValue() as string}</span> },
    { id: "interestedProject", header: "Interested Project", size: 140, enableSorting: false,
      cell: (i) => <span>{[i.row.original.InterestedProject, i.row.original.BhkPreference, i.row.original.PropertyType].filter(Boolean).join(" · ") || "—"}</span> },
    { accessorKey: "Source", header: "Source", size: 130,
      cell: (i) => (
        <div className="text-xs">
          <div>{i.row.original.Source || "—"}</div>
          <div className="text-muted-foreground">
            {[i.row.original.PlatformName, i.row.original.CampaignName, i.row.original.AdName].filter(Boolean).join(" › ") || i.row.original.ChannelPartnerName || ""}
          </div>
        </div>
      ) },
    { accessorKey: "RatePerSqFt", header: "Rate", size: 100,
      cell: (i) => <span className="text-xs">{i.row.original.RatePerSqFt ? `₹${Number(i.row.original.RatePerSqFt).toLocaleString("en-IN")}/sqft` : "—"}</span> },
    { accessorKey: "AssigneeName", header: "Assigned To", size: 110, cell: (i) => <span className="text-sm">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { accessorKey: "CreatedAt", header: "Date", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.CreatedAt ? String(i.row.original.CreatedAt).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "", size: 210, enableSorting: false,
      cell: (i) => {
        const a = i.row.original;
        const canResume = activeStage === "InProcess" && isResumeEditable(a);
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {activeStage === "InProcess" ? (
              <>
                {canResume ? (
                  <button
                    onClick={() => loadApplicationIntoWizard(a.Id)}
                    disabled={loadingApplication}
                    className="text-xs text-primary hover:underline"
                  >
                    Resume
                  </button>
                ) : null}
                {/* submitOnly: Approve/Reject only ever happen from the Admin
                    Approval Inbox (admin/super_admin/dba), never self-service here.
                    Approval now also auto-creates the Booking — see crmApplications.js. */}
                <ApprovalActions
                  status={a.Status}
                  recordId={a.Id}
                  endpoint={API}
                  submitOnly
                  onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-apps"] })}
                />
                {a.Status === "Pending" && (
                  <span className="text-xs text-muted-foreground">Pending admin approval</span>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{a.Status} — no further action</span>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              New CRM Application {applicationNo ? `— ${applicationNo}` : ""}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            {["Project/Unit", "Parking", "Bank/KYC", "Attachments", "Notes"].map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && <div className="flex-1 h-px bg-border" />}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full font-medium ${
                  step === i + 1 ? "bg-primary text-primary-foreground" : step > i + 1 ? "text-green-600" : "text-muted-foreground"
                }`}>
                  {step > i + 1 ? <CheckCircle2 size={12} /> : <span className="w-4 text-center">{i + 1}</span>}
                  {label}
                </div>
              </React.Fragment>
            ))}
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

              {/* Tree: Company > Project > Block > Floor > Unit */}
              <div className="rounded-lg border border-border p-3 space-y-2.5">
                <label className="text-xs font-semibold text-foreground block">Project / Unit (tree)</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Company *</label>
                    <select value={form.CompanyId} disabled={!!applicationId}
                      onChange={(e) => {
                        planUnlockedForUnitRef.current = null;
                        setPlanLocked(false);
                        setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", BlockId: "", FloorNo: "", PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select company</option>
                      {(companies as any[]).map((c: any) => <option key={c.Id} value={String(c.Id)}>{c.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Project *</label>
                    <select value={form.ProjectId} disabled={!!applicationId}
                      onChange={(e) => {
                        planUnlockedForUnitRef.current = null;
                        setPlanLocked(false);
                        setForm((f) => ({ ...f, ProjectId: e.target.value, BlockId: "", FloorNo: "", PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select project</option>
                      {(projectsForCompany as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Block / Tower</label>
                    <select value={form.BlockId} disabled={!!applicationId}
                      onChange={(e) => {
                        planUnlockedForUnitRef.current = null;
                        setPlanLocked(false);
                        setForm((f) => ({ ...f, BlockId: e.target.value, FloorNo: "", PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Any block</option>
                      {blocksForProject.map((b) => <option key={b.Id} value={b.Id}>{b.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Floor</label>
                    <select value={form.FloorNo} disabled={!!applicationId}
                      onChange={(e) => {
                        planUnlockedForUnitRef.current = null;
                        setPlanLocked(false);
                        setForm((f) => ({ ...f, FloorNo: e.target.value, PreferredUnitId: "", PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Any floor</option>
                      {floorsForBlock.map((fl) => <option key={fl} value={fl}>Floor {fl}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Unit *</label>
                    <select value={form.PreferredUnitId} disabled={!!applicationId}
                      onChange={(e) => {
                        planUnlockedForUnitRef.current = null;
                        setPlanLocked(false);
                        setForm((f) => ({ ...f, PreferredUnitId: e.target.value, PaymentPlanId: "" }));
                      }}
                      className={inputCls}>
                      <option value="">Select unit</option>
                      {(unitsForFloor as any[]).map((u: any) => (
                        <option key={u.Id} value={String(u.Id)}>{u.UnitName} · {u.UnitType || "—"} · {u.AreaSqFt ? `${u.AreaSqFt} sqft` : "—"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Payment Plan — decided once at Unit Master setup time for
                    this exact unit, auto-fetched and locked the moment the
                    unit above is selected. "Change" unlocks it for the
                    (rarer) deal that genuinely needs a different plan. Not
                    re-selectable on the Booking page — this is the one
                    place it's chosen. */}
                {form.PreferredUnitId && (
                  <div className="pt-2">
                    <label className={labelCls}>Payment Plan</label>
                    {planLocked ? (
                      <div className="flex items-center justify-between gap-2 bg-muted/30 rounded px-2 py-1.5">
                        <span className="text-sm text-foreground">
                          {(paymentPlans as any[]).find((p: any) => String(p.Id) === form.PaymentPlanId)?.PlanName || "—"}
                          {" "}<span className="text-xs text-muted-foreground">(auto-fetched from unit)</span>
                        </span>
                        <button type="button" onClick={() => { planUnlockedForUnitRef.current = selectedUnit?.Id ?? null; setPlanLocked(false); }}
                          className="text-xs text-primary hover:underline shrink-0">
                          Change
                        </button>
                      </div>
                    ) : (
                      <select value={form.PaymentPlanId} onChange={(e) => setForm((f) => ({ ...f, PaymentPlanId: e.target.value }))} className={inputCls}>
                        <option value="">— Use default milestone schedule —</option>
                        {applicablePaymentPlans.map((p: any) => (
                          <option key={p.Id} value={String(p.Id)}>{p.PlanName}</option>
                        ))}
                      </select>
                    )}
                    {!selectedUnit?.DefaultPaymentPlanId && (
                      <p className="text-[11px] text-muted-foreground mt-1">This unit has no default plan set in Unit Master — select one, or leave blank for the default 7-stage split.</p>
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
                  <label className={labelCls}>Rate (₹/sqft)</label>
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
              parkingRates={parkingRates}
              parkingSlots={parkingSlots}
              computedTotal={computedTotal}
            />
          )}

          {step === 3 && applicationId && (
            <BankDetailsStep
              applicationId={applicationId}
              onRegisterSave={(fn) => { saveBankDetailsRef.current = fn; }}
            />
          )}

          {step === 4 && applicationId && (
            <AttachmentsStep applicationId={applicationId} />
          )}

          {step === 5 && (
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
                <button onClick={() => setStep(3)}
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
                <button onClick={() => setStep(5)}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center gap-1">
                  Next <ChevronRight size={14} />
                </button>
              )}
              {step === 5 && (
                <button onClick={handleFinalSave} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  {saving ? "Saving..." : "Save & Close"}
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
    </SalesAutoShell>
  );
};

// ── Step 3: Bank / KYC / Nominee — identity & bank details only ───────────────
const BankDetailsStep: React.FC<{
  applicationId: number;
  onRegisterSave?: (fn: null | (() => Promise<void>)) => void;
}> = ({ applicationId, onRegisterSave }) => {
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankLoaded, setBankLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBankLoaded(false);
    setBank({ ...EMPTY_BANK });
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
      })
      .finally(() => { if (!cancelled) setBankLoaded(true); });
    return () => { cancelled = true; };
  }, [applicationId]);

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
              <input value={(bank as any)[key]} onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))} className={inputCls} />
            </div>
          ))}
        </div>
        <div className="pt-2 border-t border-border/60">
          <p className="text-xs font-medium text-foreground mb-2">Nominee</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["NomineeName", "Name"], ["NomineeRelation", "Relation"], ["NomineeContact", "Contact"], ["NomineeAddress", "Address"],
            ].map(([key, label]) => (
              <div key={key}>
                <label className={labelCls}>{label}</label>
                <input value={(bank as any)[key]} onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))} className={inputCls} />
              </div>
            ))}
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
  parkingRates: any[]; parkingSlots: any[]; computedTotal: number;
}> = ({ applicationId, projectId, blockId, parkingRates, parkingSlots, computedTotal }) => {
  const { data: allotments = [], refetch: refetchParking } = useQuery({
    queryKey: ["crm-app-parking", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
  });

  const applicableRates = useMemo(() => {
    if (!projectId) return [];
    return (parkingRates as any[]).filter((p: any) =>
      String(p.ProjectId) === projectId && (!blockId || !p.BlockId || String(p.BlockId) === blockId));
  }, [parkingRates, projectId, blockId]);

  const availableSlots = useMemo(() => {
    if (!projectId) return [];
    const takenSlotIds = new Set((allotments as any[]).map((a: any) => a.ParkingSlotId).filter(Boolean));
    return (parkingSlots as any[]).filter((s: any) =>
      String(s.ProjectId) === projectId && s.IsActive && (!blockId || !s.BlockId || String(s.BlockId) === blockId) && !takenSlotIds.has(s.Id));
  }, [parkingSlots, projectId, blockId, allotments]);

  // Slots grouped by ParkingType so e.g. two Basement slots (B-01, B-02)
  // render as one "Basement" group with two selectable rows, instead of two
  // separate top-level buttons that look like duplicate/confusing entries.
  const slotGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of availableSlots) {
      if (!map.has(s.ParkingType)) map.set(s.ParkingType, []);
      map.get(s.ParkingType)!.push(s);
    }
    return Array.from(map.entries());
  }, [availableSlots]);

  // Rate types with no specific slot inventory (e.g. "Open" parking sold by
  // count, not by a fixed slot) — these get a quantity input instead of a
  // slot picker, since one click could never mean "buy 3".
  const ratesWithoutSlots = useMemo(() => {
    const typesWithSlots = new Set(availableSlots.map((s: any) => s.ParkingType));
    return (applicableRates as any[]).filter((r: any) => !typesWithSlots.has(r.ParkingType));
  }, [applicableRates, availableSlots]);

  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<number>>(new Set());
  const [qtyByRateId, setQtyByRateId] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);

  const toggleSlot = (id: number) => {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddSelectedSlots = async () => {
    if (!selectedSlotIds.size) return;
    setAdding(true);
    try {
      let addedTotal = 0;
      for (const slotId of selectedSlotIds) {
        const slot = availableSlots.find((s: any) => s.Id === slotId);
        const rate = applicableRates.find((r: any) => r.ParkingType === slot.ParkingType) || applicableRates[0];
        if (!rate) continue;
        const res = await fetchWithAuth(`${PARKING_API}/standalone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ApplicationId: applicationId, ParkingMasterId: rate.Id,
            ParkingSlotId: slot.Id, Quantity: 1,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to add ${slot.ParkingType} ${slot.SlotNo}`);
        addedTotal += Number(data.TotalAmount) || 0;
      }
      toast.success(`${selectedSlotIds.size} parking slot(s) added — ₹${addedTotal.toLocaleString("en-IN")}`);
      setSelectedSlotIds(new Set());
      refetchParking();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleAddByQuantity = async (rate: any) => {
    const qty = parseInt(qtyByRateId[rate.Id] || "1");
    if (!Number.isFinite(qty) || qty < 1) { toast.error("Enter a valid quantity"); return; }
    setAdding(true);
    try {
      const res = await fetchWithAuth(`${PARKING_API}/standalone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: applicationId, ParkingMasterId: rate.Id,
          ParkingSlotId: null, Quantity: qty,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add parking");
      toast.success(`${rate.ParkingType} x${qty} added — ₹${Number(data.TotalAmount).toLocaleString("en-IN")}`);
      setQtyByRateId((f) => ({ ...f, [rate.Id]: "1" }));
      refetchParking();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveParking = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${PARKING_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchParking();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const parkingTotal = (allotments as any[]).reduce((s, a) => s + (Number(a.TotalAmount) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Auto-filled charges summary */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Unit Value</p>
          <p className="font-semibold text-foreground">{computedTotal ? `₹${computedTotal.toLocaleString("en-IN")}` : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Parking Charges</p>
          <p className="font-semibold text-foreground">{parkingTotal ? `₹${parkingTotal.toLocaleString("en-IN")}` : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Grand Total</p>
          <p className="font-semibold text-primary">₹{(computedTotal + parkingTotal).toLocaleString("en-IN")}</p>
        </div>
      </div>

      {/* Already-added allotments */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><ParkingSquare size={13} /> Selected Parking</label>
        {(allotments as any[]).length > 0 ? (
          <div className="space-y-1.5">
            {(allotments as any[]).map((a: any) => (
              <div key={a.Id} className="flex items-center justify-between text-xs rounded-md bg-muted/30 px-2.5 py-1.5">
                <span>{a.CurrentParkingType} {a.SlotNo ? `— Slot ${a.SlotNo}` : `× ${a.Quantity}`} · ₹{Number(a.TotalAmount).toLocaleString("en-IN")}</span>
                <button onClick={() => handleRemoveParking(a.Id)} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No parking selected yet — optional.</p>
        )}
      </div>

      {/* Add parking */}
      {!projectId ? (
        <p className="text-xs text-muted-foreground">Select a project in Step 1 to choose parking.</p>
      ) : slotGroups.length === 0 && ratesWithoutSlots.length === 0 ? (
        <p className="text-xs text-muted-foreground">No parking rates configured for this project.</p>
      ) : (
        <div className="space-y-3">
          {slotGroups.map(([type, slots]) => {
            const rate = applicableRates.find((r: any) => r.ParkingType === type);
            return (
              <div key={type} className="rounded-lg border border-border p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    {type} {rate ? `— ₹${Number(rate.Charge).toLocaleString("en-IN")} each` : ""}
                  </label>
                  <span className="text-[11px] text-muted-foreground">{slots.length} available</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 max-h-32 overflow-y-auto">
                  {slots.map((s: any) => (
                    <label key={s.Id} className="flex items-center gap-1.5 text-xs border border-border rounded-md px-2 py-1.5 cursor-pointer hover:border-primary hover:bg-primary/5 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                      <input type="checkbox" checked={selectedSlotIds.has(s.Id)} onChange={() => toggleSlot(s.Id)} />
                      Slot {s.SlotNo}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {selectedSlotIds.size > 0 && (
            <button onClick={handleAddSelectedSlots} disabled={adding}
              className="w-full text-xs px-3 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-40">
              {adding ? "Adding..." : `Add ${selectedSlotIds.size} Selected Slot(s)`}
            </button>
          )}
          {ratesWithoutSlots.map((r: any) => (
            <div key={r.Id} className="rounded-lg border border-border p-3 flex items-center justify-between gap-2">
              <div className="text-xs">
                <p className="font-semibold text-foreground">{r.ParkingType}</p>
                <p className="text-muted-foreground">₹{Number(r.Charge).toLocaleString("en-IN")} each — no fixed slot</p>
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min="1" value={qtyByRateId[r.Id] ?? "1"}
                  onChange={(e) => setQtyByRateId((f) => ({ ...f, [r.Id]: e.target.value }))}
                  className="w-16 text-xs border border-border rounded px-2 py-1.5 bg-background" />
                <button onClick={() => handleAddByQuantity(r)} disabled={adding}
                  className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-40">
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Step 4: Attachments — document upload only ─────────────────────────────────
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
