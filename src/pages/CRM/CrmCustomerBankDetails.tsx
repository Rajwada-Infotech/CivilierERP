import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Save } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const API = "/api/crm/customer-bank-details";
const BKG_API = "/api/crm/bookings";

const EMPTY_FORM = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  NomineeName: "", NomineeRelation: "", NomineeDob: "", NomineeContact: "", NomineeAddress: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "", Notes: "",
};

async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBankDetail(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${API}/booking/${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}

const CrmCustomerBankDetails: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const [bookingId, setBookingId] = useState<number | null>(bkgFilter ? parseInt(bkgFilter) : null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  useQuery({
    queryKey: ["crm-bank-detail", bookingId],
    queryFn: async () => {
      const d = await fetchBankDetail(bookingId!);
      setForm(d ? {
        BankName: d.BankName || "", BranchName: d.BranchName || "", AccountNo: d.AccountNo || "",
        IfscCode: d.IfscCode || "", AccountHolderName: d.AccountHolderName || "",
        NomineeName: d.NomineeName || "", NomineeRelation: d.NomineeRelation || "",
        NomineeDob: d.NomineeDob ? String(d.NomineeDob).slice(0,10) : "", NomineeContact: d.NomineeContact || "",
        NomineeAddress: d.NomineeAddress || "", PanNo: d.PanNo || "", AadhaarNo: d.AadhaarNo || "",
        Occupation: d.Occupation || "", AnnualIncome: d.AnnualIncome != null ? String(d.AnnualIncome) : "",
        Notes: d.Notes || "",
      } : { ...EMPTY_FORM });
      return d;
    },
    enabled: !!bookingId,
  });

  const handleSave = async () => {
    if (!bookingId) { toast.error("Select a booking first"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${bookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Bank & nominee details saved");
      qc.invalidateQueries({ queryKey: ["crm-bank-detail", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
    </div>
  );

  return (
    <SalesAutoShell title="CRM — Customer Bank & Nominee Details" subtitle="KYC captured before agreement preparation">
      <div className="max-w-2xl space-y-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
          <select value={bookingId || ""} onChange={(e) => setBookingId(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
            <option value="">Select booking</option>
            {(bookings as any[]).map((b: any) => (
              <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
            ))}
          </select>
        </div>

        {bookingId && (
          <>
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold">Bank Details</h3>
              <div className="grid grid-cols-2 gap-3">
                {field("BankName", "Bank Name")}
                {field("BranchName", "Branch Name")}
                {field("AccountNo", "Account Number")}
                {field("IfscCode", "IFSC Code")}
                {field("AccountHolderName", "Account Holder Name")}
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold">Nominee Details</h3>
              <div className="grid grid-cols-2 gap-3">
                {field("NomineeName", "Nominee Name")}
                {field("NomineeRelation", "Relation")}
                {field("NomineeDob", "Date of Birth", "date")}
                {field("NomineeContact", "Contact Number")}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nominee Address</label>
                <textarea value={form.NomineeAddress} onChange={(e) => setForm((f) => ({ ...f, NomineeAddress: e.target.value }))}
                  rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold">Identity</h3>
              <div className="grid grid-cols-2 gap-3">
                {field("PanNo", "PAN Number")}
                {field("AadhaarNo", "Aadhaar Number")}
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold">Occupation & Income</h3>
              <div className="grid grid-cols-2 gap-3">
                {field("Occupation", "Occupation *")}
                {field("AnnualIncome", "Annual Income (₹) — if applicable", "number")}
              </div>
            </div>

            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-40">
              <Save size={14} /> {saving ? "Saving..." : "Save Details"}
            </button>
          </>
        )}
      </div>
    </SalesAutoShell>
  );
};

export default CrmCustomerBankDetails;
