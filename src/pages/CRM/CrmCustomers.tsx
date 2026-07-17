import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, ChevronRight, IdCard, Users2, IndianRupee } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/customers";
const SA_LEADS_API = "/api/sa/leads";

const EMPTY_FORM = {
  LeadId: "", CustomerName: "", Mobile: "", AltMobile: "", Email: "",
  PanNo: "", Address: "", City: "", State: "", Pincode: "", DateOfBirth: "",
  CoApplicantName: "", CoApplicantMobile: "", CoApplicantPanNo: "", CoApplicantRelation: "",
  Notes: "",
};

async function fetchCustomers(search: string): Promise<any[]> {
  try {
    const url = search ? `${API}?search=${encodeURIComponent(search)}` : API;
    const res = await fetchWithAuth(url);
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

function EditCustomerDialog({ customer, onClose, onSaved }: { customer: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    CustomerName: customer.CustomerName || "", Mobile: customer.Mobile || "",
    AltMobile: customer.AltMobile || "", Email: customer.Email || "",
    PanNo: customer.PanNo || "", Address: customer.Address || "",
    City: customer.City || "", State: customer.State || "", Pincode: customer.Pincode || "",
    DateOfBirth: customer.DateOfBirth ? String(customer.DateOfBirth).slice(0, 10) : "",
    CoApplicantName: customer.CoApplicantName || "", CoApplicantMobile: customer.CoApplicantMobile || "",
    CoApplicantPanNo: customer.CoApplicantPanNo || "", CoApplicantRelation: customer.CoApplicantRelation || "",
    Notes: customer.Notes || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${customer.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <IdCard size={16} className="text-primary" /> {customer.CustomerNo} — Edit Customer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "CustomerName", label: "Customer Name *", type: "text" },
              { key: "Mobile", label: "Mobile *", type: "text" },
              { key: "AltMobile", label: "Alternate Mobile", type: "text" },
              { key: "Email", label: "Email", type: "email" },
              { key: "PanNo", label: "PAN Number *", type: "text" },
              { key: "DateOfBirth", label: "Date of Birth", type: "date" },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                <input type={type} value={(form as any)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Address *</label>
            <textarea value={form.Address} onChange={(e) => setForm((f) => ({ ...f, Address: e.target.value }))}
              rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["City", "State", "Pincode"].map((key) => (
              <div key={key}>
                <label className="text-xs text-muted-foreground block mb-1">{key}</label>
                <input type="text" value={(form as any)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Users2 size={13} /> Co-Applicant (optional)</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "CoApplicantName", label: "Name" },
                { key: "CoApplicantMobile", label: "Mobile" },
                { key: "CoApplicantPanNo", label: "PAN" },
                { key: "CoApplicantRelation", label: "Relation" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type="text" value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes</label>
            <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
              rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>

          {customer.outstanding && Number(customer.outstanding.TotalDue) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h3 className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-2"><IndianRupee size={12} /> Outstanding — across every booking</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground block">Total Due</span><span className="font-semibold">₹{Number(customer.outstanding.TotalDue).toLocaleString("en-IN")}</span></div>
                <div><span className="text-muted-foreground block">Paid</span><span className="font-semibold text-green-700">₹{Number(customer.outstanding.TotalPaid).toLocaleString("en-IN")}</span></div>
                <div><span className="text-muted-foreground block">Outstanding</span><span className="font-semibold text-amber-700">₹{Number(customer.outstanding.TotalOutstanding).toLocaleString("en-IN")}</span></div>
              </div>
            </div>
          )}

          {customer.applications?.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">Applications filed by this customer ({customer.applications.length})</h3>
              <div className="space-y-1.5">
                {customer.applications.map((a: any) => (
                  <div key={a.Id} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-primary">{a.ApplicationNo}</span>
                    <span className="text-muted-foreground">{a.Status}</span>
                    {a.BookingNo && <span className="text-green-600">→ {a.BookingNo}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmCustomers: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["crm-customers", search],
    queryFn: () => fetchCustomers(search),
    staleTime: 30_000,
  });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-dropdown"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });

  const { data: editingCustomer } = useQuery({
    queryKey: ["crm-customer-detail", editingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${editingId}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!editingId,
  });

  const handleLeadChange = (leadId: string) => {
    const lead = (leads as any[]).find((l: any) => String(l.Id) === leadId);
    if (lead) {
      setForm((f) => ({
        ...f,
        LeadId: leadId,
        CustomerName: lead.CustomerName || "",
        Mobile: lead.Mobile || "",
        AltMobile: lead.AltMobile || "",
        Email: lead.Email || "",
      }));
    } else {
      setForm((f) => ({ ...f, LeadId: "" }));
    }
  };

  const handleCreate = async () => {
    if (!form.CustomerName.trim() || !form.Mobile.trim() || !form.PanNo.trim() || !form.Address.trim()) {
      toast.error("Customer Name, Mobile, PAN and Address are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, LeadId: form.LeadId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Customer ${data.CustomerNo} registered`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-customers"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => customers as any[], [customers]);

  // Every column's cell is wrapped with the same row-click handler so the
  // whole row stays clickable to open the edit dialog, matching the old
  // hand-rolled <tr onClick={...}> behavior.
  const customerColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "CustomerNo", header: "Customer No", size: 110,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer font-mono text-xs font-semibold text-primary">
          {i.getValue() as string}
        </div>
      ) },
    { accessorKey: "CustomerName", header: "Name", size: 160,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium text-foreground">{i.row.original.CustomerName}</div>
          {i.row.original.LeadUid && <div className="text-xs text-muted-foreground">Lead: {i.row.original.LeadUid}</div>}
        </div>
      ) },
    { accessorKey: "Mobile", header: "Mobile", size: 110,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer text-muted-foreground">
          {i.getValue() as string}
        </div>
      ) },
    { accessorKey: "PanNo", header: "PAN", size: 100,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer font-mono text-xs">
          {(i.getValue() as string) || "—"}
        </div>
      ) },
    { id: "location", header: "Address", size: 130, enableSorting: false,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer text-xs">
          {[i.row.original.CustomerCity ?? i.row.original.City, i.row.original.CustomerState ?? i.row.original.State].filter(Boolean).join(", ") || "—"}
        </div>
      ) },
    { accessorKey: "CoApplicantName", header: "Co-Applicant", size: 120,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer text-xs">
          {(i.getValue() as string) || "—"}
        </div>
      ) },
    { accessorKey: "ApplicationCount", header: "Applications", size: 120,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer">
          <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-blue-600 bg-blue-50 border-blue-200">
            {i.row.original.ApplicationCount} application{i.row.original.ApplicationCount === 1 ? "" : "s"}
          </span>
        </div>
      ) },
    { accessorKey: "CreatedAt", header: "Registered", size: 100,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer text-xs text-muted-foreground">
          {i.row.original.CreatedAt ? String(i.row.original.CreatedAt).slice(0, 10) : "—"}
        </div>
      ) },
    { id: "chevron", header: "", size: 40, enableSorting: false,
      cell: (i) => (
        <div onClick={() => setEditingId(i.row.original.Id)} className="cursor-pointer">
          <ChevronRight size={14} className="text-muted-foreground" />
        </div>
      ) },
  ];

  return (
    <SalesAutoShell
      title="CRM — Customers"
      subtitle="The master identity record every Application is built on — name, KYC, address, co-applicant"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={14} /> New Customer
        </button>
      }
    >
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, mobile, PAN, customer no..."
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <DataTable
        data={filtered}
        columns={customerColumns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No customers found"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* New Customer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">New Customer</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Link to Existing Lead (optional)</label>
              <select value={form.LeadId} onChange={(e) => handleLeadChange(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Walk-in / New Customer —</option>
                {(leads as any[]).map((l: any) => (
                  <option key={l.Id} value={String(l.Id)}>{l.CustomerName} · {l.Mobile} · {l.LeadUid}</option>
                ))}
              </select>
              {form.LeadId && <p className="text-xs text-green-600 mt-1">Name, mobile and email prefilled from lead</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "CustomerName", label: "Customer Name *", type: "text" },
                { key: "Mobile", label: "Mobile *", type: "text" },
                { key: "AltMobile", label: "Alternate Mobile", type: "text" },
                { key: "Email", label: "Email", type: "email" },
                { key: "PanNo", label: "PAN Number *", type: "text" },
                { key: "DateOfBirth", label: "Date of Birth", type: "date" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type={type} value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Address *</label>
              <textarea value={form.Address} onChange={(e) => setForm((f) => ({ ...f, Address: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {["City", "State", "Pincode"].map((key) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{key}</label>
                  <input type="text" value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border p-3 space-y-3">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Users2 size={13} /> Co-Applicant (optional)</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "CoApplicantName", label: "Name" },
                  { key: "CoApplicantMobile", label: "Mobile" },
                  { key: "CoApplicantPanNo", label: "PAN" },
                  { key: "CoApplicantRelation", label: "Relation" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                    <input type="text" value={(form as any)[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>

            <p className="text-xs text-muted-foreground">
              Name, Mobile, PAN and Address are required — every Application will auto-fetch its details from this record.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? "Registering..." : "Register Customer"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {editingId && editingCustomer && (
        <EditCustomerDialog
          customer={editingCustomer}
          onClose={() => setEditingId(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["crm-customers"] })}
        />
      )}
    </SalesAutoShell>
  );
};

export default CrmCustomers;
