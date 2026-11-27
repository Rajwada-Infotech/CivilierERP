// One customer dossier: highlights strip, read-only/edit mode toggle, KYC & address fields,
// outstanding money summary, linked applications/bookings, and safe delete confirmation.
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, FileText, IdCard, IndianRupee, Lock, PenSquare, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GridGuidance, GridHighlights, GridStatusPill, GridToneMark } from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { asName } from "../payments/parts";
import {
  API, CUST_KEY_INK, CUST_KEY_LINE, CUST_KEY_RED, CustBlock, EMPTY_FORM, checkCustomer, type CustomerForm,
} from "./config";
import { CustomerFields } from "./CustomerFields";

function toForm(c: any): CustomerForm {
  return {
    ...EMPTY_FORM,
    CustomerName: c.CustomerName || "",
    Mobile: c.Mobile || "",
    AltMobile: c.AltMobile || "",
    Email: c.Email || "",
    PanNo: c.PanNo || "",
    GstNo: c.GstNo || "",
    AadhaarNo: c.AadhaarNo || "",
    Occupation: c.Occupation || "",
    AnnualIncome: c.AnnualIncome != null ? String(c.AnnualIncome) : "",
    PermanentAddress: c.PermanentAddress || "",
    PermanentCity: c.PermanentCity || "",
    PermanentState: c.PermanentState || "",
    PermanentPincode: c.PermanentPincode || "",
    IsCurrentSameAsPermanent: c.IsCurrentSameAsPermanent !== false,
    CurrentAddress: c.CurrentAddress || "",
    CurrentCity: c.CurrentCity || "",
    CurrentState: c.CurrentState || "",
    CurrentPincode: c.CurrentPincode || "",
    DateOfBirth: c.DateOfBirth ? String(c.DateOfBirth).slice(0, 10) : "",
    CoApplicantName: c.CoApplicantName || "",
    CoApplicantMobile: c.CoApplicantMobile || "",
    CoApplicantPanNo: c.CoApplicantPanNo || "",
    CoApplicantRelation: c.CoApplicantRelation || "",
    InvoiceMode: c.InvoiceMode === "Invoice" ? "Invoice" : "NonInvoice",
    Notes: c.Notes || "",
  };
}

export function CustomerDialog({
  customer, canEdit, canDelete, startEditing, onClose,
}: {
  customer: any; canEdit: boolean; canDelete: boolean; startEditing: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CustomerForm>(() => toForm(customer));
  const [locked, setLocked] = useState(!(startEditing && canEdit));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const apps: any[] = customer.applications || [];
  const liveBookings = apps.filter((a) => a.BookingStatus && !["Cancelled", "Rejected", "Expired"].includes(a.BookingStatus));
  const owed = customer.outstanding && Number(customer.outstanding.TotalDue) > 0 ? customer.outstanding : null;
  const cityLabel = [customer.PermanentCity, customer.PermanentState].filter(Boolean).join(", ");

  const refresh = () => ["crm-customers", "crm-customers-counts", "crm-customer-detail", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const save = async () => {
    const problem = checkCustomer(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const { LeadId: _lead, ...body } = form;
      const res = await fetchWithAuth(`${API}/${customer.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
        <DialogHeader className="sr-only">
          <DialogTitle>{customer.CustomerNo} · {customer.CustomerName}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <GridHighlights
            icon={IdCard}
            object={`Customer · ${customer.CustomerNo}${customer.LeadUid ? ` · from ${customer.LeadUid}` : ""}`}
            title={<span className="capitalize">{asName(customer.CustomerName)}</span>}
            status={
              <GridToneMark
                tone={locked ? "done" : "waiting"}
                text={locked ? "Verified record" : "Editing"}
              />
            }
            sub={
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {cityLabel && <span>{cityLabel}</span>}
                {customer.Email && <span>{cityLabel ? `· ${customer.Email}` : customer.Email}</span>}
                {!cityLabel && !customer.Email && <span>Customer identity &amp; KYC profile</span>}
              </div>
            }
            actions={
              <div className="pr-8 flex flex-wrap items-center gap-2">
                <Link to={`/crm/customer-360?id=${customer.Id}`} className={`${CUST_KEY_LINE} h-8 px-3 text-foreground`}>
                  <ExternalLink size={12} /> Customer 360
                </Link>
                {locked && canEdit && (
                  <button type="button" onClick={() => setLocked(false)} className={`${CUST_KEY_INK} h-8 px-3.5`}>
                    <PenSquare size={12} /> Edit
                  </button>
                )}
              </div>
            }
            fields={[
              { label: "Mobile", value: customer.Mobile || "—" },
              { label: "PAN", value: customer.PanNo || "—" },
              { label: "Aadhaar", value: customer.AadhaarNo || "—" },
              { label: "Billing", value: customer.InvoiceMode === "Invoice" ? "Invoice (GST)" : "Non-invoice" },
              { label: "Applications", value: `${apps.length} linked` },
              { label: "Outstanding", value: owed ? fmtRupees(owed.TotalOutstanding) : "—" },
            ]}
          />

          {locked && (
            <GridGuidance
              tone="moving"
              title="Read-only record"
              text={
                <span className="inline-flex items-center gap-1.5">
                  <Lock size={12} />
                  {canEdit
                    ? "Every application and booking reads KYC from this profile — click Edit above to unlock changes."
                    : "You have view-only access to customer records."}
                </span>
              }
            />
          )}

          <CustomerFields form={form} setForm={setForm} readOnly={locked} />

          {(owed || apps.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {owed ? (
                <CustBlock title="Financial summary" icon={<IndianRupee size={14} className="text-primary" />}>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { label: "Total due", val: owed.TotalDue, cls: "text-foreground" },
                      { label: "Total paid", val: owed.TotalPaid, cls: "text-foreground" },
                      { label: "Outstanding", val: owed.TotalOutstanding, cls: Number(owed.TotalOutstanding) > 0 ? "text-destructive" : "text-foreground" },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-border/60 bg-muted/35 px-3 py-2.5 min-w-0">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`text-sm font-bold tabular-nums mt-0.5 truncate ${item.cls}`}>{fmtRupees(item.val)}</p>
                      </div>
                    ))}
                  </div>
                </CustBlock>
              ) : <div className="hidden lg:block" />}

              {apps.length > 0 && (
                <CustBlock title={`Linked applications (${apps.length})`} icon={<FileText size={14} className="text-primary" />}>
                  <div className="divide-y divide-border/70 max-h-44 overflow-y-auto thin-scroll">
                    {apps.map((a) => (
                      <div key={a.Id} className="flex items-center justify-between gap-3 py-2 text-xs">
                        <span className="font-mono font-medium text-foreground tabular-nums">{a.ApplicationNo}</span>
                        <GridStatusPill status={a.Status || "Draft"} />
                        {a.BookingNo ? (
                          <Link to={`/crm/bookings?applicationId=${a.Id}`} className="text-primary hover:underline tabular-nums font-medium">
                            {a.BookingNo}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">No booking</span>
                        )}
                      </div>
                    ))}
                  </div>
                </CustBlock>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
            <div className="flex flex-wrap items-center gap-2">
              {canDelete && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={liveBookings.length > 0}
                  title={liveBookings.length ? "A booking of this customer is still live" : undefined}
                  className={`${CUST_KEY_LINE} h-9 px-3 !text-destructive !border-destructive/40`}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
              {confirmDelete && (
                <>
                  <span className="text-xs font-medium text-foreground">Delete {customer.CustomerNo} permanently?</span>
                  <button type="button" onClick={remove} disabled={deleting} className={`${CUST_KEY_RED} h-8 px-3`}>
                    {deleting ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className={`${CUST_KEY_LINE} h-8 px-3 text-foreground`}>
                    Keep
                  </button>
                </>
              )}
              {canDelete && liveBookings.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Cannot delete: {liveBookings.length} live booking{liveBookings.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {locked ? (
                <button type="button" onClick={onClose} className={`${CUST_KEY_LINE} h-9 px-4 text-foreground`}>Close</button>
              ) : (
                <>
                  <button type="button" onClick={() => { setForm(toForm(customer)); setLocked(true); }} className={`${CUST_KEY_LINE} h-9 px-4 text-foreground`}>
                    Cancel
                  </button>
                  <button type="button" onClick={save} disabled={saving} className={`${CUST_KEY_INK} h-9 px-4`}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
