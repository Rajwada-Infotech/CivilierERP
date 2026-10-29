// Wizard step: the application's co-applicants.
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Trash2, Users2, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";
import { CO_APPLICANT_API, fetchCustomers, inputCls, labelCls, KEY_INK } from "./config";
import { isValidPhone, PHONE_HINT } from "@/lib/phone";

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

export const CoApplicantStep: React.FC<{
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
      CustomerId: co.CustomerId ?? null,
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
  // An existing customer can be picked as a co-applicant: their details are
  // filled in and they are linked, never duplicated (the server also refuses
  // the main applicant or someone already on this application).
  const { data: customerPool = [] } = useQuery({ queryKey: ["crm-customers-dropdown"], queryFn: fetchCustomers, staleTime: 60_000, enabled: editingId !== null });
  const pickCustomer = (id: string) => {
    const c = (customerPool as any[]).find((x: any) => String(x.Id) === id);
    if (!c) { setDraft((d: any) => ({ ...d, CustomerId: null })); return; }
    setDraft((d: any) => ({
      ...d, CustomerId: c.Id, Name: c.CustomerName || "", Mobile: c.Mobile || "", Email: c.Email || "",
      PanNo: c.PanNo || "", AadhaarNo: c.AadhaarNo || "", Occupation: c.Occupation || d.Occupation,
      DateOfBirth: c.DateOfBirth ? String(c.DateOfBirth).slice(0, 10) : d.DateOfBirth,
      Address: c.Address || d.Address, City: c.City || d.City, State: c.State || d.State, Pincode: c.Pincode || d.Pincode,
    }));
  };

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
    if (!isValidPhone(draft.Mobile)) { toast.error(`Co-applicant mobile must be ${PHONE_HINT}`); return; }
    if (draft.PanNo?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(draft.PanNo.trim().toUpperCase())) { toast.error("Co-applicant PAN must be in format ABCDE1234F"); return; }
    if (draft.AadhaarNo?.trim() && !/^\d{12}$/.test(draft.AadhaarNo.trim())) { toast.error("Co-applicant Aadhaar must be exactly 12 digits"); return; }
    if (draft.Pincode?.trim() && !/^\d{6}$/.test(draft.Pincode.trim())) { toast.error("Co-applicant Pincode must be exactly 6 digits"); return; }
    if (draft.Email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.Email.trim())) { toast.error("Invalid co-applicant email address"); return; }
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    }
  };

  return (
    <div className="space-y-4">
      <div className=" border border-border p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Users2 size={13} /> Co-Applicants</label>
        <p className="text-[0.6875rem] text-muted-foreground">The main applicant is Applicant 1. Each co-applicant is Applicant 2, 3 … and is added to the customer pool (an existing customer with the same mobile, PAN or email is linked, not duplicated).</p>
        {(coApplicants as any[]).length > 0 ? (
          <div className="space-y-1.5">
            {(coApplicants as any[]).map((co: any) => (
              <div key={co.Id}
                onClick={() => setViewingCoApplicant(co)}
                className="flex items-center justify-between text-xs bg-muted/30 px-2.5 py-1.5 cursor-pointer hover:bg-muted/50">
                <span className="flex items-center gap-1.5">
                  {co.ApplicantNo && <span className="bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary">Applicant {co.ApplicantNo}</span>}
                  <span className="font-medium text-foreground">{co.Name}</span>
                  {co.Relation && <span className="text-muted-foreground">({co.Relation})</span>}
                  {co.Mobile && <span className="text-muted-foreground">— {co.Mobile}</span>}
                  {co.CustomerNo && <span className="text-muted-foreground">· customer {co.CustomerNo}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); startEdit(co); }} className="text-primary hover:underline">Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(co.Id); }} className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No co-applicants added yet — optional.</p>
        )}
        {editingId === null && (
          <button onClick={startAdd}
            className="text-xs px-3 py-1.5 border border-border text-primary hover:bg-muted/40 flex items-center gap-1">
            <Plus size={12} /> Add Co-Applicant
          </button>
        )}
      </div>

      {editingId !== null && (
        <div className=" border border-border p-3 space-y-3">
          <div>
            <label className={labelCls}>Existing customer (optional)</label>
            <SearchableSelect
              value={draft.CustomerId != null ? String(draft.CustomerId) : ""}
              onChange={pickCustomer}
              placeholder="Pick an existing customer, or fill in a new person below"
              searchPlaceholder="Search name, mobile or customer no..."
              options={(customerPool as any[]).map((c: any) => ({ value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <label className={labelCls}>PAN (Permanent Account Number)</label>
              <input value={draft.PanNo} onChange={(e) => setDraft((d: any) => ({ ...d, PanNo: e.target.value.toUpperCase() }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Aadhaar No.</label>
              <input value={draft.AadhaarNo} onChange={(e) => setDraft((d: any) => ({ ...d, AadhaarNo: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Date of Birth</label>
              <DateInput value={draft.DateOfBirth} onChange={(e) => setDraft((d: any) => ({ ...d, DateOfBirth: e.target.value }))} className={inputCls} />
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
                    className="border-border" />
                  Same as {applicantName || "applicant"}'s address
                </label>
              )}
            </div>
            <input value={draft.Address} readOnly={sameAsApplicant}
              onChange={(e) => setDraft((d: any) => ({ ...d, Address: e.target.value }))}
              className={inputCls + (sameAsApplicant ? " bg-muted/30 text-muted-foreground cursor-not-allowed" : "")} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
            <textarea value={draft.Notes} onChange={(e) => setDraft((d: any) => ({ ...d, Notes: e.target.value }))} rows={2} className={`${inputCls} resize-none h-auto py-2`} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={cancelEdit} className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className={`${KEY_INK} h-9 px-4`}>
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
        <BodyPortal><div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setViewingCoApplicant(null)}
        >
          <div
            className="bg-background border border-border max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
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
                className="px-3 py-1.5 text-xs border border-border text-primary hover:bg-muted/40">
                Edit
              </button>
              <button type="button" onClick={() => setViewingCoApplicant(null)}
                className={`${KEY_INK} h-9 px-4`}>
                Close
              </button>
            </div>
          </div>
        </div></BodyPortal>
      )}
    </div>
  );
};
