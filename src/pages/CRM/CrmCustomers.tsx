import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, Search, ChevronRight, IdCard, IndianRupee, Lock, Pencil, BookUser,
  User, MapPin, Briefcase, FileText, UserPlus, AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/customers";
const SA_LEADS_API = "/api/sa/leads";

const EMPTY_FORM = {
  LeadId: "", CustomerName: "", Mobile: "", AltMobile: "", Email: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "", DateOfBirth: "",
  PermanentAddress: "", PermanentCity: "", PermanentState: "", PermanentPincode: "",
  IsCurrentSameAsPermanent: true,
  CurrentAddress: "", CurrentCity: "", CurrentState: "", CurrentPincode: "",
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
// Only converted leads are offered here — this dropdown IS the real "only a
// converted lead may enter the CRM module" gate now (Leads -> Customer ->
// Application; see the matching check in crmCustomers.js POST /). Further
// narrowed client-side (below, availableLeads) to ones not already linked to
// another customer.
async function fetchLeadOptions(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(`${SA_LEADS_API}?status=Converted`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

// Shared block: Permanent Address (always required + visible) followed by a
// "Current address same as permanent" toggle that reveals a second,
// independent set of fields only when unchecked. Used identically by both
// the New Customer dialog and the Edit dialog so the two never drift.
function AddressFields({
  form, setForm, readOnly, inputCls,
}: {
  form: any;
  setForm: (updater: (f: any) => any) => void;
  readOnly: boolean;
  inputCls: string;
}) {
  return (
    <>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Permanent Address *</label>
        <textarea value={form.PermanentAddress} readOnly={readOnly}
          onChange={(e) => setForm((f: any) => ({ ...f, PermanentAddress: e.target.value }))}
          rows={2} className={`${inputCls} resize-none`} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {([
          { key: "PermanentCity", label: "City" },
          { key: "PermanentState", label: "State" },
          { key: "PermanentPincode", label: "Pincode" },
        ] as const).map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs text-muted-foreground block mb-1">{label}</label>
            <input type="text" value={form[key]} readOnly={readOnly}
              onChange={(e) => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
              className={inputCls} />
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={form.IsCurrentSameAsPermanent}
          disabled={readOnly}
          onChange={(e) => setForm((f: any) => ({ ...f, IsCurrentSameAsPermanent: e.target.checked }))}
        />
        Current address same as permanent
      </label>

      {!form.IsCurrentSameAsPermanent && (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Current Address</label>
            <textarea value={form.CurrentAddress} readOnly={readOnly}
              onChange={(e) => setForm((f: any) => ({ ...f, CurrentAddress: e.target.value }))}
              rows={2} className={`${inputCls} resize-none`} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([
              { key: "CurrentCity", label: "City" },
              { key: "CurrentState", label: "State" },
              { key: "CurrentPincode", label: "Pincode" },
            ] as const).map(({ key, label }) => (
              <div key={key}>
                <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                <input type="text" value={form[key]} readOnly={readOnly}
                  onChange={(e) => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EditCustomerDialog({ customer, onClose, onSaved }: { customer: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    CustomerName: customer.CustomerName || "", Mobile: customer.Mobile || "",
    AltMobile: customer.AltMobile || "", Email: customer.Email || "",
    PanNo: customer.PanNo || "", AadhaarNo: customer.AadhaarNo || "",
    Occupation: customer.Occupation || "", AnnualIncome: customer.AnnualIncome != null ? String(customer.AnnualIncome) : "",
    PermanentAddress: customer.PermanentAddress || "",
    PermanentCity: customer.PermanentCity || "", PermanentState: customer.PermanentState || "", PermanentPincode: customer.PermanentPincode || "",
    IsCurrentSameAsPermanent: customer.IsCurrentSameAsPermanent !== false,
    CurrentAddress: customer.CurrentAddress || "",
    CurrentCity: customer.CurrentCity || "", CurrentState: customer.CurrentState || "", CurrentPincode: customer.CurrentPincode || "",
    DateOfBirth: customer.DateOfBirth ? String(customer.DateOfBirth).slice(0, 10) : "",
    CoApplicantName: customer.CoApplicantName || "", CoApplicantMobile: customer.CoApplicantMobile || "",
    CoApplicantPanNo: customer.CoApplicantPanNo || "", CoApplicantRelation: customer.CoApplicantRelation || "",
    Notes: customer.Notes || "",
  });
  const [saving, setSaving] = useState(false);
  // Opens read-only every time — an explicit "Edit" click is required before
  // any field becomes editable, and a successful save re-locks it. Prevents
  // the classic "clicked a row to look, accidentally fat-fingered a field,
  // hit Save without noticing" class of data-corruption mistake on a record
  // this central (every Application/Booking reads its KYC off this row).
  const [locked, setLocked] = useState(true);
  const inputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;

  const handleSave = async () => {
    if (form.Mobile?.trim() && !/^\d{10}$/.test(form.Mobile.trim())) {
      toast.error("Mobile must be exactly 10 digits"); return;
    }
    if (form.PanNo?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.PanNo.trim().toUpperCase())) {
      toast.error("PAN must be in format ABCDE1234F"); return;
    }
    if (form.AadhaarNo?.trim() && !/^\d{12}$/.test(form.AadhaarNo.trim())) {
      toast.error("Aadhaar must be exactly 12 digits"); return;
    }
    if (form.Email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.Email.trim())) {
      toast.error("Please enter a valid email address"); return;
    }
    if (form.PermanentPincode?.trim() && !/^\d{6}$/.test(form.PermanentPincode.trim())) {
      toast.error("Pincode must be exactly 6 digits"); return;
    }
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
      setLocked(true);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-5 gap-2.5">
        <DialogHeader className="space-y-0.5">
          <DialogTitle className="font-heading text-base font-bold flex items-center justify-between gap-2 pr-6">
            <span className="flex items-center gap-2">
              <IdCard size={16} className="text-amber-500" /> {customer.CustomerNo} — Edit Customer
            </span>
            {locked ? (
              <button onClick={() => setLocked(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all shrink-0">
                <Pencil size={12} /> Edit
              </button>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-amber-600 shrink-0">
                <Pencil size={12} /> Editing
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {locked && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5">
            <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
          </div>
        )}

        {/* Core identity fields — same compact two-column layout as New
            Customer: Personal + Financial merged into one 3-col section on
            the left, Address + Notes on the right, so the fixed field set
            fits on one screen. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border p-3 space-y-2">
            <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
              <User size={13} className="text-amber-500" /> Personal &amp; Financial Details
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { key: "CustomerName", label: "Customer Name *", type: "text" },
                { key: "Mobile", label: "Mobile *", type: "text" },
                { key: "AltMobile", label: "Alternate Mobile", type: "text" },
                { key: "Email", label: "Email", type: "email" },
                { key: "PanNo", label: "PAN Number *", type: "text" },
                { key: "AadhaarNo", label: "Aadhaar Number", type: "text" },
                { key: "DateOfBirth", label: "Date of Birth", type: "date" },
                { key: "Occupation", label: "Occupation", type: "text" },
                { key: "AnnualIncome", label: "Annual Income", type: "number" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-0.5">{label}</label>
                  <input type={type} value={(form as any)[key]} readOnly={locked}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-border p-3 space-y-2">
              <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
                <MapPin size={13} className="text-amber-500" /> Address
              </h3>
              <AddressFields form={form} setForm={setForm} readOnly={locked} inputCls={inputCls} />
            </div>

            {/* Co-applicants are now managed at the Application level, not on the Customer record.
                 Each Application has its own independent co-applicants — use the Co-Applicant
                 tab in the Application wizard to add them. */}

            <div className="rounded-xl border border-border p-3 space-y-2">
              <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
                <FileText size={13} className="text-amber-500" /> Notes
              </h3>
              <textarea value={form.Notes} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className={`${inputCls} resize-none`} />
            </div>
          </div>
        </div>

        {/* Outstanding + Applications side by side (not stacked, and not
            crammed into the right column above) — this is what was still
            forcing a scroller: two variable-height blocks stacking under an
            already-full-height column. Applications also scrolls internally
            past a handful of rows instead of growing the dialog further. */}
        {(customer.outstanding && Number(customer.outstanding.TotalDue) > 0) || customer.applications?.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {customer.outstanding && Number(customer.outstanding.TotalDue) > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-amber-700 dark:text-amber-400"><IndianRupee size={13} /> Outstanding</h3>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground block">Total Due</span><span className="font-semibold">₹{Number(customer.outstanding.TotalDue).toLocaleString("en-IN")}</span></div>
                  <div><span className="text-muted-foreground block">Paid</span><span className="font-semibold text-green-700">₹{Number(customer.outstanding.TotalPaid).toLocaleString("en-IN")}</span></div>
                  <div><span className="text-muted-foreground block">Outstanding</span><span className="font-semibold text-amber-700">₹{Number(customer.outstanding.TotalOutstanding).toLocaleString("en-IN")}</span></div>
                </div>
              </div>
            ) : <div />}

            {customer.applications?.length > 0 && (
              <div className="rounded-xl border border-border p-3 space-y-2">
                <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground"><IdCard size={13} className="text-amber-500" /> Applications ({customer.applications.length})</h3>
                <div className="space-y-1.5 max-h-20 overflow-y-auto thin-scroll">
                  {customer.applications.map((a: any) => (
                    <div key={a.Id} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-amber-600 dark:text-amber-400">{a.ApplicationNo}</span>
                      <span className="text-muted-foreground">{a.Status}</span>
                      {a.BookingNo && <span className="text-green-600">→ {a.BookingNo}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2.5 border-t border-border">
          {locked ? (
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
          ) : (
            <>
              <button onClick={() => { setLocked(true); onClose(); }}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmCustomers: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  // Duplicate detection: populated by the /suggest endpoint when Mobile or
  // PAN is filled in. Shown as an inline warning card above the form footer.
  const [dupSuggestions, setDupSuggestions] = useState<any[]>([]);
  const [dupChecking, setDupChecking] = useState(false);
  const dupDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hits the /suggest endpoint with the current Mobile + PAN + Name values.
  // Debounced 400ms so it doesn't fire on every keystroke.
  const checkDuplicates = useCallback(async (mobile: string, pan: string, name: string) => {
    if (dupDebounce.current) clearTimeout(dupDebounce.current);
    const mob = mobile.trim();
    const panVal = pan.trim().toUpperCase();
    const nm = name.trim();
    if (!mob && !panVal && !nm) { setDupSuggestions([]); return; }
    dupDebounce.current = setTimeout(async () => {
      try {
        setDupChecking(true);
        const params = new URLSearchParams();
        if (mob) params.set("mobile", mob);
        if (panVal) params.set("pan", panVal);
        if (nm) params.set("name", nm);
        const res = await fetchWithAuth(`${API}/suggest?${params}`);
        if (res.ok) setDupSuggestions(await res.json());
      } catch { /* non-blocking */ }
      finally { setDupChecking(false); }
    }, 400);
  }, []);

  const handleCreate = async () => {
    if (!form.CustomerName.trim() || !form.Mobile.trim() || !form.PanNo.trim() || !form.PermanentAddress.trim()) {
      toast.error("Customer Name, Mobile, PAN and Permanent Address are required");
      return;
    }
    if (!/^\d{10}$/.test(form.Mobile.trim())) {
      toast.error("Mobile must be exactly 10 digits"); return;
    }
    if (form.AltMobile.trim() && !/^\d{10}$/.test(form.AltMobile.trim())) {
      toast.error("Alternate mobile must be exactly 10 digits"); return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.PanNo.trim().toUpperCase())) {
      toast.error("PAN must be in format ABCDE1234F"); return;
    }
    if (form.AadhaarNo.trim() && !/^\d{12}$/.test(form.AadhaarNo.trim())) {
      toast.error("Aadhaar must be exactly 12 digits"); return;
    }
    if (form.Email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.Email.trim())) {
      toast.error("Please enter a valid email address"); return;
    }
    if (form.PermanentPincode.trim() && !/^\d{6}$/.test(form.PermanentPincode.trim())) {
      toast.error("Pincode must be exactly 6 digits"); return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, LeadId: form.LeadId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        // When the backend returns a 409 with an existingCustomerId, surface an
        // inline warning with a "View Customer" link instead of just a toast —
        // so staff can open the existing record directly without hunting for it.
        if (res.status === 409 && data.existingCustomerId) {
          setDupSuggestions((prev) => {
            const already = prev.some((d) => d.Id === data.existingCustomerId);
            if (already) return prev;
            return [{ Id: data.existingCustomerId, _fromError: true, _errorMsg: data.error }, ...prev];
          });
          toast.warning("A matching customer already exists — see the warning below");
          return;
        }
        throw new Error(data.error);
      }
      toast.success(`Customer ${data.CustomerNo} registered`);
      setDialogOpen(false);
      setDupSuggestions([]);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-customers"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const { data: customers = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-customers", search],
    queryFn: () => fetchCustomers(search),
    staleTime: 30_000,
  });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-dropdown"], queryFn: fetchLeadOptions, staleTime: 5 * 60_000 });

  // Deep-link from CrmLeads.tsx's "Create Customer" action
  // (/crm/customers?leadId=X) — opens the New Customer dialog with that
  // converted lead pre-selected, same as picking it by hand from "Link to
  // Existing Lead" below. Waits for the leads list to load so
  // handleLeadChange can actually find the row to prefill from.
  useEffect(() => {
    const leadId = searchParams.get("leadId");
    if (!leadId || !(leads as any[]).length) return;
    setForm({ ...EMPTY_FORM });
    handleLeadChange(leadId);
    setDialogOpen(true);
    setSearchParams((sp) => { sp.delete("leadId"); return sp; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, leads]);

  // Deep-link from CrmLeads.tsx's "View Customer" action (a converted lead
  // already linked to a customer) — opens that customer's detail dialog
  // directly instead of the list-only page.
  useEffect(() => {
    const customerId = searchParams.get("customerId");
    if (!customerId) return;
    setEditingId(parseInt(customerId));
    setSearchParams((sp) => { sp.delete("customerId"); return sp; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Converted leads not yet linked to another (active) customer — the
  // "already used" half of the gate, mirroring the LeadId uniqueness check
  // in crmCustomers.js POST /.
  const availableLeads = useMemo(() => {
    const usedLeadIds = new Set((customers as any[]).map((c: any) => c.LeadId).filter(Boolean));
    return (leads as any[]).filter((l: any) => !usedLeadIds.has(l.Id));
  }, [leads, customers]);

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
    if (!form.CustomerName.trim() || !form.Mobile.trim() || !form.PanNo.trim() || !form.PermanentAddress.trim()) {
      toast.error("Customer Name, Mobile, PAN and Permanent Address are required");
      return;
    }
    if (!/^\d{10}$/.test(form.Mobile.trim())) {
      toast.error("Mobile must be exactly 10 digits"); return;
    }
    if (form.AltMobile.trim() && !/^\d{10}$/.test(form.AltMobile.trim())) {
      toast.error("Alternate mobile must be exactly 10 digits"); return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.PanNo.trim().toUpperCase())) {
      toast.error("PAN must be in format ABCDE1234F"); return;
    }
    if (form.AadhaarNo.trim() && !/^\d{12}$/.test(form.AadhaarNo.trim())) {
      toast.error("Aadhaar must be exactly 12 digits"); return;
    }
    if (form.Email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.Email.trim())) {
      toast.error("Please enter a valid email address"); return;
    }
    if (form.PermanentPincode.trim() && !/^\d{6}$/.test(form.PermanentPincode.trim())) {
      toast.error("Pincode must be exactly 6 digits"); return;
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
      toast.error(translateError(e.message));
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
          {[i.row.original.PermanentCity, i.row.original.PermanentState].filter(Boolean).join(", ") || "—"}
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

  usePageRights("crm-customers");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Customers"]} />
      <CrmShell
        title="CRM — Customers"
      subtitle="The master identity record every Application is built on — name, KYC, address, co-applicant"
      action={
        <div className="flex items-center gap-2">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => navigate("/masters/customers")}
            title="Every CRM customer auto-creates/syncs a matching ledger head here for Finance/GL"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <BookUser size={14} /> Customer Ledger (Master)
          </button>
          <button onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
            <Plus size={14} /> New Customer
          </button>
        </div>
      }
    >
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, mobile, PAN, customer no..."
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
      </div>

      <DataTable
        data={filtered}
        columns={customerColumns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No customers found"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* New Customer Dialog — wide two-column layout, compact enough to
          fit the whole field set on one screen without an inner scroller. */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setDupSuggestions([]); } }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-5 gap-2.5">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="font-heading text-base font-bold flex items-center gap-2">
              <UserPlus size={16} className="text-amber-500" /> New Customer
            </DialogTitle>
          </DialogHeader>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Link to Existing Lead (optional)</label>
            <select value={form.LeadId} onChange={(e) => handleLeadChange(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40">
              <option value="">— Walk-in / New Customer —</option>
              {availableLeads.map((l: any) => (
                <option key={l.Id} value={String(l.Id)}>{l.CustomerName} · {l.Mobile} · {l.LeadUid}</option>
              ))}
            </select>
            {form.LeadId && <p className="text-xs text-green-600 mt-1">Name, mobile and email prefilled from lead — only converted leads are listed</p>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Left column: identity + financial profile, merged into one
                3-column section — 9 fields fit in 3 rows instead of the old
                2-column layout's 4+1 rows across two separate cards. */}
            <div className="rounded-xl border border-border p-3 space-y-2">
              <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
                <User size={13} className="text-amber-500" /> Personal &amp; Financial Details
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { key: "CustomerName", label: "Customer Name *", type: "text" },
                  { key: "Mobile", label: "Mobile *", type: "text" },
                  { key: "AltMobile", label: "Alternate Mobile", type: "text" },
                  { key: "Email", label: "Email", type: "email" },
                  { key: "PanNo", label: "PAN Number *", type: "text" },
                  { key: "AadhaarNo", label: "Aadhaar Number", type: "text" },
                  { key: "DateOfBirth", label: "Date of Birth", type: "date" },
                  { key: "Occupation", label: "Occupation", type: "text" },
                  { key: "AnnualIncome", label: "Annual Income", type: "number" },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground block mb-0.5">{label}</label>
                    <input type={type} value={(form as any)[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      onBlur={() => {
                        // Trigger duplicate check when Mobile or PAN loses focus —
                        // these are the two highest-confidence dedup signals.
                        if (key === "Mobile" || key === "PanNo") {
                          checkDuplicates(form.Mobile, form.PanNo, form.CustomerName);
                        }
                      }}
                      className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
                  </div>
                ))}

              </div>
            </div>

            {/* Right column: address + notes */}
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-3 space-y-2">
                <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
                  <MapPin size={13} className="text-amber-500" /> Address
                </h3>
                <AddressFields
                  form={form}
                  setForm={setForm}
                  readOnly={false}
                  inputCls="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                />
              </div>

              {/* Co-applicants moved to the Application wizard — Add Co-Applicant tab */}

              <div className="rounded-xl border border-border p-3 space-y-2">
                <h3 className="text-xs font-heading font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
                  <FileText size={13} className="text-amber-500" /> Notes
                </h3>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={2} className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Name, Mobile, PAN and Permanent Address are required — every Application will auto-fetch its details from this record.
          </p>

          {/* Duplicate warning banner — shown when the /suggest endpoint finds
              existing customers that match the entered Mobile, PAN, or Name.
              Each candidate is shown as a compact card; staff can dismiss
              individual cards or open the existing record directly. */}
          {(dupChecking || dupSuggestions.length > 0) && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-50/60 dark:bg-amber-900/10 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle size={13} />
                {dupChecking ? "Checking for duplicates…" : `${dupSuggestions.length} possible duplicate${dupSuggestions.length > 1 ? "s" : ""} found — verify before registering`}
              </div>
              {dupSuggestions.map((d: any) => (
                <div key={d.Id} className="flex items-start justify-between gap-2 rounded-lg border border-amber-300/50 bg-white dark:bg-card px-3 py-2 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    {d._fromError ? (
                      <p className="font-medium text-red-600">{d._errorMsg}</p>
                    ) : (
                      <>
                        <p className="font-semibold text-foreground truncate">{d.CustomerName} <span className="font-normal text-muted-foreground">· {d.CustomerNo}</span></p>
                        <p className="text-muted-foreground">{[d.Mobile, d.PanNo, d.PermanentCity].filter(Boolean).join(" · ")}</p>
                        {d.ApplicationCount > 0 && <p className="text-indigo-600">{d.ApplicationCount} application{d.ApplicationCount > 1 ? "s" : ""}</p>}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => { setDialogOpen(false); setDupSuggestions([]); setForm({ ...EMPTY_FORM }); setEditingId(d.Id); }}
                      className="px-2 py-1 rounded-md text-xs font-medium border border-amber-400/60 text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                    >
                      View Customer
                    </button>
                    <button
                      onClick={() => setDupSuggestions((p) => p.filter((x) => x.Id !== d.Id))}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Dismiss"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2.5 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setDupSuggestions([]); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm text-white rounded-lg font-medium shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
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
    </CrmShell>
    </>
  );
};

export default CrmCustomers;