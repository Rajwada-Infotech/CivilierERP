// One customer opened: read-only first (every application and booking reads its KYC from this record, so a stray
// keystroke on a look must not save), Edit unlocks it, saving locks it again. Shows what is outstanding and the
// customer's applications, and deletes when no booking is still live (the server checks again).
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IdCard, Lock, PenSquare, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { API, Block, EMPTY_FORM, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, checkCustomer, type CustomerForm } from "./config";
import { CustomerFields } from "./CustomerFields";

const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function toForm(c: any): CustomerForm {
  return {
    ...EMPTY_FORM,
    CustomerName: c.CustomerName || "", Mobile: c.Mobile || "", AltMobile: c.AltMobile || "", Email: c.Email || "",
    PanNo: c.PanNo || "", GstNo: c.GstNo || "", AadhaarNo: c.AadhaarNo || "",
    Occupation: c.Occupation || "", AnnualIncome: c.AnnualIncome != null ? String(c.AnnualIncome) : "",
    PermanentAddress: c.PermanentAddress || "", PermanentCity: c.PermanentCity || "", PermanentState: c.PermanentState || "", PermanentPincode: c.PermanentPincode || "",
    IsCurrentSameAsPermanent: c.IsCurrentSameAsPermanent !== false,
    CurrentAddress: c.CurrentAddress || "", CurrentCity: c.CurrentCity || "", CurrentState: c.CurrentState || "", CurrentPincode: c.CurrentPincode || "",
    DateOfBirth: c.DateOfBirth ? String(c.DateOfBirth).slice(0, 10) : "",
    CoApplicantName: c.CoApplicantName || "", CoApplicantMobile: c.CoApplicantMobile || "", CoApplicantPanNo: c.CoApplicantPanNo || "", CoApplicantRelation: c.CoApplicantRelation || "",
    InvoiceMode: c.InvoiceMode === "Invoice" ? "Invoice" : "NonInvoice",
    Notes: c.Notes || "",
  };
}

export function CustomerDialog({ customer, canEdit, canDelete, startEditing, onClose }: { customer: any; canEdit: boolean; canDelete: boolean; startEditing: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CustomerForm>(() => toForm(customer));
  const [locked, setLocked] = useState(!(startEditing && canEdit));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const apps: any[] = customer.applications || [];
  const liveBookings = apps.filter((a) => a.BookingStatus && !["Cancelled", "Rejected", "Expired"].includes(a.BookingStatus));
  const owed = customer.outstanding && Number(customer.outstanding.TotalDue) > 0 ? customer.outstanding : null;

  const refresh = () => ["crm-customers", "crm-customer-detail", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const save = async () => {
    const problem = checkCustomer(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const { LeadId: _lead, ...body } = form;
      const res = await fetchWithAuth(`${API}/${customer.Id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the customer.");
      toast.success("Customer saved");
      refresh();
      setLocked(true);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`${API}/${customer.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the customer.");
      toast.success(`${customer.CustomerNo} deleted`);
      refresh();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center justify-between gap-3 pr-6">
            <span className="min-w-0">
              <span className={`block ${LBL}`}>{locked ? "Customer" : "Editing customer"}</span>
              <span className="font-heading text-lg font-bold tabular-nums text-foreground flex items-center gap-2"><IdCard size={16} /> {customer.CustomerNo} · {customer.CustomerName}</span>
              {customer.LeadUid && <span className="block text-xs text-muted-foreground font-normal mt-0.5">From lead {customer.LeadUid}</span>}
            </span>
            {locked && canEdit && (
              <button onClick={() => setLocked(false)} className={`${KEY_INK} h-9 px-4`}><PenSquare size={13} /> Edit</button>
            )}
          </DialogTitle>
        </DialogHeader>

        {locked && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-2" style={{ border: RULE_SOFT }}>
            <Lock size={11} /> Read-only. {canEdit ? "Edit unlocks it; saving locks it again." : "You can look but not change it."}
          </p>
        )}

        <CustomerFields form={form} setForm={setForm} readOnly={locked} />

        {(owed || apps.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {owed ? (
              <Block title="Money">
                <div className="grid grid-cols-3 gap-px" style={{ background: "hsl(var(--foreground) / 0.15)", border: RULE_SOFT }}>
                  {[["Due", owed.TotalDue], ["Paid", owed.TotalPaid], ["Outstanding", owed.TotalOutstanding]].map(([k, v]) => (
                    <div key={k as string} className="bg-card px-3 py-2.5">
                      <p className={LBL}>{k as string}</p>
                      <p className={`font-heading font-bold tabular-nums mt-0.5 ${k === "Outstanding" ? "text-destructive" : "text-foreground"}`}>{inr(v)}</p>
                    </div>
                  ))}
                </div>
              </Block>
            ) : <div className="hidden lg:block" />}
            {apps.length > 0 && (
              <Block title={`Applications · ${apps.length}`}>
                <div className="max-h-36 overflow-y-auto">
                  {apps.map((a) => (
                    <div key={a.Id} className="flex items-center justify-between gap-3 py-1.5 text-xs" style={{ borderBottom: RULE_SOFT }}>
                      <span className="font-heading tabular-nums">{a.ApplicationNo}</span>
                      <SheetMark text={a.Status || "Draft"} tone={statusTone(a.Status || "Draft")} />
                      <span className="text-muted-foreground font-heading tabular-nums">{a.BookingNo ? `→ ${a.BookingNo}` : ""}</span>
                    </div>
                  ))}
                </div>
              </Block>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3" style={{ borderTop: RULE }}>
          <div className="flex items-center gap-2">
            {canDelete && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} disabled={liveBookings.length > 0} title={liveBookings.length ? "A booking of this customer is still live" : undefined}
                className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}>
                <Trash2 size={13} /> Delete
              </button>
            )}
            {confirmDelete && (
              <>
                <span className="text-xs text-foreground">Delete {customer.CustomerNo} for good?</span>
                <button onClick={remove} disabled={deleting} className={`${KEY_RED} h-9 px-3`}>{deleting ? "Deleting…" : "Delete"}</button>
                <button onClick={() => setConfirmDelete(false)} className={`${KEY_LINE} h-9 px-3`}>Keep</button>
              </>
            )}
            {canDelete && liveBookings.length > 0 && <span className="text-[0.6875rem] text-muted-foreground">Can't delete: {liveBookings.length} live booking{liveBookings.length > 1 ? "s" : ""}</span>}
          </div>
          <div className="flex gap-2">
            {locked ? (
              <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
            ) : (
              <>
                <button onClick={() => { setForm(toForm(customer)); setLocked(true); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                <button onClick={save} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : "Save"}</button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
