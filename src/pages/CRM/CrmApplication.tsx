import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, ChevronRight, CheckCircle2, Clock, XCircle, TrendingUp, Building2, IdCard, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";

const API = "/api/crm/applications";
const CUSTOMER_API = "/api/crm/customers";
const COMPANY_API = "/api/business/dropdown";
const SA_LEADS_API = "/api/sa/leads";
const UNIT_API = "/api/unit-master";

const STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Cancelled"];
const PROPERTY_TYPES = ["Apartment", "Villa", "Plot", "Commercial", "Row House", "Penthouse", "Studio", "Other"];
const BHK_OPTIONS = ["1 BHK", "1.5 BHK", "2 BHK", "2.5 BHK", "3 BHK", "3.5 BHK", "4 BHK", "4+ BHK"];
// Mirrors SaLead.SourceType so lead source values stay consistent across the whole system
const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];

const statusColor: Record<string, string> = {
  Draft:     "text-muted-foreground bg-muted/50 border-border",
  Pending:   "text-blue-600 bg-blue-50 border-blue-200",
  Approved:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-orange-600 bg-orange-50 border-orange-200",
};

const EMPTY_FORM = {
  CustomerId: "", CompanyId: "",
  ProjectId: "", PreferredUnitId: "", PropertyType: "", BhkPreference: "",
  BudgetMin: "", BudgetMax: "",
  Source: "", PlatformId: "", CampaignId: "", AdId: "", ChannelPartnerId: "",
  AssignedTo: "", Notes: "",
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
const stageDot: Record<Stage, string> = { InProcess: "bg-blue-400", Converted: "bg-green-500", NotConverted: "bg-red-400" };
async function fetchCustomers(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(CUSTOMER_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
// Used only to auto-fetch a selected customer's original lead interest/
// source-chain data (property type, budget, assigned salesperson, ad/
// campaign) onto this application — Lead selection itself now happens once,
// on the Customer record, not per-application.
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
async function fetchUserOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!res.ok) return [];
    const d: any[] = await res.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
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

const CrmApplication: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [activeStage, setActiveStage] = useState<Stage>("InProcess");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: apps = [], isLoading } = useQuery({ queryKey: ["crm-apps"], queryFn: fetchApps, staleTime: 60_000 });
  const { data: customers = [] } = useQuery({ queryKey: ["crm-customers-dropdown"], queryFn: fetchCustomers, staleTime: 60_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-dropdown"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });
  const { data: companies = [] } = useQuery({ queryKey: ["crm-companies-dropdown"], queryFn: fetchCompanies, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUserOptions, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: platforms = [] } = useQuery({ queryKey: ["sa-platforms"], queryFn: fetchPlatforms, staleTime: 5 * 60_000 });
  const { data: campaigns = [] } = useQuery({ queryKey: ["sa-campaigns-dropdown"], queryFn: fetchCampaigns, staleTime: 5 * 60_000 });
  const { data: ads = [] } = useQuery({ queryKey: ["sa-ads-dropdown"], queryFn: fetchAds, staleTime: 5 * 60_000 });
  const { data: channelPartners = [] } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchChannelPartners, staleTime: 5 * 60_000 });

  const selectedCustomer = useMemo(() =>
    (customers as any[]).find((c: any) => String(c.Id) === form.CustomerId) || null,
    [customers, form.CustomerId]
  );

  // Projects narrow to the selected company once one is chosen
  const projectsForCompany = useMemo(() => {
    if (!form.CompanyId) return projects as any[];
    return (projects as any[]).filter((p: any) => String(p.CompanyId) === form.CompanyId);
  }, [projects, form.CompanyId]);

  // Units offered narrow to the selected project once one is chosen
  const unitsForProject = useMemo(() => {
    if (!form.ProjectId) return units as any[];
    return (units as any[]).filter((u: any) => String(u.ProjectId) === form.ProjectId);
  }, [units, form.ProjectId]);

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

  // The moment a customer with a linked lead is picked, auto-fetch that
  // lead's property interest / budget / source chain onto the application —
  // the "auto fetched as the flow" behavior the Customer page's own lead
  // link already started. Only fills fields still blank, so re-selecting a
  // different customer never clobbers something staff already typed.
  useEffect(() => {
    if (!selectedCustomer?.LeadId) return;
    const lead = (leads as any[]).find((l: any) => l.Id === selectedCustomer.LeadId);
    if (!lead) return;
    setForm((f) => ({
      ...f,
      PropertyType: f.PropertyType || lead.PropertyType || "",
      BhkPreference: f.BhkPreference || lead.BhkPreference || "",
      BudgetMin: f.BudgetMin || (lead.BudgetMin != null ? String(lead.BudgetMin) : ""),
      BudgetMax: f.BudgetMax || (lead.BudgetMax != null ? String(lead.BudgetMax) : ""),
      AssignedTo: f.AssignedTo || (lead.AssignedSalespersonId ? String(lead.AssignedSalespersonId) : ""),
      Source: f.Source || lead.SourceType || "",
      PlatformId: f.PlatformId || (lead.PlatformId ? String(lead.PlatformId) : ""),
      CampaignId: f.CampaignId || (lead.CampaignId ? String(lead.CampaignId) : ""),
      AdId: f.AdId || (lead.AdId ? String(lead.AdId) : ""),
      ChannelPartnerId: f.ChannelPartnerId || (lead.ChannelPartnerId ? String(lead.ChannelPartnerId) : ""),
    }));
  }, [selectedCustomer, leads]);

  const handleSave = async () => {
    if (!form.CustomerId) {
      toast.error("Select a customer");
      return;
    }
    if (!form.CompanyId || !form.ProjectId) {
      toast.error("Select a company and project");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          CustomerId:       parseInt(form.CustomerId),
          CompanyId:        form.CompanyId        || null,
          ProjectId:        form.ProjectId        || null,
          PreferredUnitId:  form.PreferredUnitId  || null,
          PlatformId:       form.PlatformId       || null,
          CampaignId:       form.CampaignId       || null,
          AdId:             form.AdId             || null,
          ChannelPartnerId: form.ChannelPartnerId || null,
          AssignedTo:       form.AssignedTo       || null,
          BudgetMin:        form.BudgetMin        || null,
          BudgetMax:        form.BudgetMax        || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create application");
      toast.success(`Application ${data.ApplicationNo} created — pending admin approval`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-apps"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Applications"
      subtitle="Manage customer applications from walk-ins and leads"
      action={
        <button onClick={() => setDialogOpen(true)}
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

      {/* ── Table ── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                {(activeStage === "Converted"
                  ? ["App No", "Applicant", "Mobile", "Booking", "Unit / Project", "Value", "Booked On", ""]
                  : ["App No", "Applicant", "Mobile", "Interested Project", "Source", "Budget", "Assigned To", "Status", "Date", ""]
                ).map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  {activeStage === "Converted" ? "No converted applications yet" : activeStage === "NotConverted" ? "No rejected/cancelled applications" : "No applications in process"}
                </td></tr>
              ) : (filtered as any[]).map((a: any) => activeStage === "Converted" ? (
                <tr key={a.Id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{a.ApplicationNo}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{a.ApplicantName}</div>
                    {a.LeadUid && <div className="text-xs text-muted-foreground">Lead: {a.LeadUid}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{a.Mobile}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-semibold text-foreground">{a.BookingNo}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-green-600 bg-green-50 border-green-200">{a.BookingStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{[a.BookingProjectName, a.BookingUnitNo].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 text-xs font-medium">{a.BookingTotalValue ? `₹${Number(a.BookingTotalValue).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{a.BookingDate ? String(a.BookingDate).slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/crm/bookings?applicationId=${a.Id}`)}
                      className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Building2 size={12} /> View Booking <ChevronRight size={12} />
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={a.Id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{a.ApplicationNo}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{a.ApplicantName}</div>
                    {a.LeadUid && <div className="text-xs text-muted-foreground">Lead: {a.LeadUid}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{a.Mobile}</td>
                  <td className="px-4 py-3">{[a.InterestedProject, a.BhkPreference, a.PropertyType].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{a.Source || "—"}</div>
                    <div className="text-muted-foreground">
                      {[a.PlatformName, a.CampaignName, a.AdName].filter(Boolean).join(" › ") || a.ChannelPartnerName || ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {a.BudgetMin || a.BudgetMax
                      ? `₹${a.BudgetMin ? (a.BudgetMin / 1e5).toFixed(1) + "L" : "?"} – ₹${a.BudgetMax ? (a.BudgetMax / 1e5).toFixed(1) + "L" : "?"}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">{a.AssigneeName || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[a.Status] || ""}`}>{a.Status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{a.CreatedAt ? String(a.CreatedAt).slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {activeStage === "InProcess" ? (
                        <>
                          {/* submitOnly: Approve/Reject only ever happen from the Admin
                              Approval Inbox (admin/super_admin/dba), never self-service here */}
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
                          {a.Status === "Approved" && (
                            <button onClick={() => navigate(`/crm/bookings?applicationId=${a.Id}`)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                              <TrendingUp size={12} /> Convert to Booking <ChevronRight size={12} />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{a.Status} — no further action</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Application Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">New CRM Application</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Customer — the single source of identity/KYC now */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Customer *</label>
                <a href="/crm/customers" target="_blank" rel="noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ExternalLink size={11} /> New Customer
                </a>
              </div>
              <select value={form.CustomerId} onChange={(e) => setForm((f) => ({ ...f, CustomerId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
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
                  {selectedCustomer.CoApplicantName && <div className="text-muted-foreground">Co-Applicant: {selectedCustomer.CoApplicantName}</div>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Company *</label>
                <select value={form.CompanyId}
                  onChange={(e) => setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", PreferredUnitId: "" }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select company</option>
                  {(companies as any[]).map((c: any) => (
                    <option key={c.Id} value={String(c.Id)}>{c.Name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Project *</label>
                <select value={form.ProjectId}
                  onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, PreferredUnitId: "" }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select project</option>
                  {(projectsForCompany as any[]).map((p: any) => (
                    <option key={p.Id} value={String(p.Id)}>{p.Name}</option>
                  ))}
                </select>
              </div>
              {[
                { key: "BudgetMin", label: "Budget Min (₹)", type: "number" },
                { key: "BudgetMax", label: "Budget Max (₹)", type: "number" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type={type} value={form[key as keyof typeof form]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Unit Preference</label>
                <select value={form.PreferredUnitId} onChange={(e) => setForm((f) => ({ ...f, PreferredUnitId: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">— No preference —</option>
                  {(unitsForProject as any[]).map((u: any) => (
                    <option key={u.Id} value={String(u.Id)}>{u.ProjectName} — {u.BlockName} — {u.UnitName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Property Type</label>
                <select value={form.PropertyType} onChange={(e) => setForm((f) => ({ ...f, PropertyType: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select type</option>
                  {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">BHK Preference</label>
                <select value={form.BhkPreference} onChange={(e) => setForm((f) => ({ ...f, BhkPreference: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select BHK</option>
                  {BHK_OPTIONS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Assigned To</label>
                <select value={form.AssignedTo} onChange={(e) => setForm((f) => ({ ...f, AssignedTo: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">— Unassigned —</option>
                  {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
            </div>

            {/* Source — deep chain, not a flat label */}
            <div className="rounded-lg border border-border p-3 space-y-3">
              <label className="text-xs font-semibold text-foreground block">Source</label>
              <select value={form.Source}
                onChange={(e) => setForm((f) => ({ ...f, Source: e.target.value, PlatformId: "", CampaignId: "", AdId: "", ChannelPartnerId: "" }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select source</option>
                {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              {form.Source === "Ad" && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Platform</label>
                    <select value={form.PlatformId}
                      onChange={(e) => setForm((f) => ({ ...f, PlatformId: e.target.value, CampaignId: "", AdId: "" }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">Select</option>
                      {(platforms as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Campaign</label>
                    <select value={form.CampaignId}
                      onChange={(e) => setForm((f) => ({ ...f, CampaignId: e.target.value, AdId: "" }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">Select</option>
                      {(campaignsForPlatform as any[]).map((c: any) => <option key={c.Id} value={String(c.Id)}>{c.Name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Ad</label>
                    <select value={form.AdId} onChange={(e) => setForm((f) => ({ ...f, AdId: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">Select</option>
                      {(adsForCampaign as any[]).map((a: any) => <option key={a.Id} value={String(a.Id)}>{a.Name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {form.Source === "Referral" && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Channel Partner</label>
                  <select value={form.ChannelPartnerId} onChange={(e) => setForm((f) => ({ ...f, ChannelPartnerId: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="">Select channel partner</option>
                    {(channelPartners as any[]).map((cp: any) => <option key={cp.Id} value={String(cp.Id)}>{cp.Name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>

            <p className="text-xs text-muted-foreground">
              New applications are created <span className="font-medium text-foreground">Pending</span> admin approval. Only an admin/super admin can approve or reject, from the Admin Approval Inbox.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? "Creating..." : "Create Application"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmApplication;
