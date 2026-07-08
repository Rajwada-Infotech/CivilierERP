import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";

const API = "/api/crm/applications";
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
  LeadId: "", ApplicantName: "", Mobile: "", AltMobile: "", Email: "",
  ProjectId: "", PreferredUnitId: "", PropertyType: "", BhkPreference: "",
  BudgetMin: "", BudgetMax: "",
  Source: "", PlatformId: "", CampaignId: "", AdId: "", ChannelPartnerId: "",
  AssignedTo: "", Notes: "",
};

async function fetchApps(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchLeadOptions(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(SA_LEADS_API);
    if (!res.ok) return [];
    return res.json();
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: apps = [], isLoading } = useQuery({ queryKey: ["crm-apps"], queryFn: fetchApps, staleTime: 60_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-dropdown"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUserOptions, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: platforms = [] } = useQuery({ queryKey: ["sa-platforms"], queryFn: fetchPlatforms, staleTime: 5 * 60_000 });
  const { data: campaigns = [] } = useQuery({ queryKey: ["sa-campaigns-dropdown"], queryFn: fetchCampaigns, staleTime: 5 * 60_000 });
  const { data: ads = [] } = useQuery({ queryKey: ["sa-ads-dropdown"], queryFn: fetchAds, staleTime: 5 * 60_000 });
  const { data: channelPartners = [] } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchChannelPartners, staleTime: 5 * 60_000 });

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

  const filtered = useMemo(() => {
    return (apps as any[]).filter((a: any) => {
      const s = !search || a.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || a.Mobile?.includes(search) || a.ApplicationNo?.includes(search);
      const st = statusFilter === "All" || a.Status === statusFilter;
      return s && st;
    });
  }, [apps, search, statusFilter]);

  const handleLeadChange = (leadId: string) => {
    const lead = (leads as any[]).find((l: any) => String(l.Id) === leadId);
    if (lead) {
      setForm((f) => ({
        ...f,
        LeadId: leadId,
        ApplicantName: lead.CustomerName || "",
        Mobile: lead.Mobile || "",
        AltMobile: lead.AltMobile || "",
        Email: lead.Email || "",
        PropertyType: lead.PropertyType || f.PropertyType,
        BhkPreference: lead.BhkPreference || f.BhkPreference,
        BudgetMin: lead.BudgetMin != null ? String(lead.BudgetMin) : f.BudgetMin,
        BudgetMax: lead.BudgetMax != null ? String(lead.BudgetMax) : f.BudgetMax,
        AssignedTo: lead.AssignedSalespersonId ? String(lead.AssignedSalespersonId) : f.AssignedTo,
        // Inherit the lead's full source chain — this is the "in depth" part:
        // the application doesn't lose track of which ad/campaign/channel
        // partner actually brought this customer in.
        Source: lead.SourceType || f.Source,
        PlatformId: lead.PlatformId ? String(lead.PlatformId) : f.PlatformId,
        CampaignId: lead.CampaignId ? String(lead.CampaignId) : f.CampaignId,
        AdId: lead.AdId ? String(lead.AdId) : f.AdId,
        ChannelPartnerId: lead.ChannelPartnerId ? String(lead.ChannelPartnerId) : f.ChannelPartnerId,
      }));
    } else {
      setForm((f) => ({ ...f, LeadId: "" }));
    }
  };

  const handleSave = async () => {
    if (!form.ApplicantName.trim() || !form.Mobile.trim()) {
      toast.error("Applicant Name and Mobile are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          LeadId:           form.LeadId           || null,
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
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, app no..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="All">All Statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                {["App No", "Applicant", "Mobile", "Interested Project", "Source", "Budget", "Assigned To", "Status", "Date", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">No applications found</td></tr>
              ) : (filtered as any[]).map((a: any) => (
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
                          className="flex items-center gap-1 text-xs text-primary hover:underline">
                          Booking <ChevronRight size={12} />
                        </button>
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
            {/* From existing lead */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Link to Existing Lead (optional)</label>
              <select value={form.LeadId} onChange={(e) => handleLeadChange(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Walk-in / New Customer —</option>
                {(leads as any[]).map((l: any) => (
                  <option key={l.Id} value={String(l.Id)}>
                    {l.CustomerName} · {l.Mobile} · {l.LeadUid}
                  </option>
                ))}
              </select>
              {form.LeadId && <p className="text-xs text-green-600 mt-1">Customer info and source chain prefilled from lead</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "ApplicantName", label: "Applicant Name *", type: "text" },
                { key: "Mobile", label: "Mobile *", type: "text" },
                { key: "AltMobile", label: "Alternate Mobile", type: "text" },
                { key: "Email", label: "Email", type: "email" },
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
                <label className="text-xs text-muted-foreground block mb-1">Interested Project</label>
                <select value={form.ProjectId}
                  onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, PreferredUnitId: "" }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">— No preference —</option>
                  {(projects as any[]).map((p: any) => (
                    <option key={p.Id} value={String(p.Id)}>{p.Name}</option>
                  ))}
                </select>
              </div>
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
