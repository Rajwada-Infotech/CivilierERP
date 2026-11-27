// New customer registration: optionally prefilled from a converted lead, with real-time duplicate detection
// on mobile, PAN, and email before creating the record.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Sparkles, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import {
  API, CUST_KEY_INK, CUST_KEY_LINE, CustBlock, CustField, EMPTY_FORM, checkCustomer, fetchLeadPool, type CustomerForm,
} from "./config";
import { CustomerFields } from "./CustomerFields";

export function NewCustomerDialog({
  leadId, onClose, onOpenCustomer,
}: { leadId: string | null; onClose: () => void; onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CustomerForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [dups, setDups] = useState<any[]>([]);
  const [dupChecking, setDupChecking] = useState(false);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: pool = [], isLoading: loadingLeads } = useQuery({
    queryKey: ["crm-leads-pool"],
    queryFn: fetchLeadPool,
    staleTime: 30_000,
  });
  const leads = pool.filter((l) => !l.CustomerId);

  const pickLead = (id: string) => {
    const lead = leads.find((l) => String(l.Id) === id);
    setForm((f) => (lead
      ? { ...f, LeadId: id, CustomerName: lead.CustomerName || "", Mobile: lead.Mobile || "", AltMobile: lead.AltMobile || "", Email: lead.Email || "" }
      : { ...f, LeadId: "" }));
  };

  const picked = useRef(false);
  useEffect(() => {
    if (!leadId || picked.current || loadingLeads) return;
    picked.current = true;
    if (leads.some((l) => String(l.Id) === leadId)) pickLead(leadId);
    else toast.warning("That lead already has a customer, or is no longer converted.");
  }, [leadId, loadingLeads]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkDuplicates = useCallback((mobile: string, pan: string, name: string) => {
    if (dupTimer.current) clearTimeout(dupTimer.current);
    const params = new URLSearchParams();
    if (mobile.trim()) params.set("mobile", mobile.trim());
    if (pan.trim()) params.set("pan", pan.trim().toUpperCase());
    if (name.trim()) params.set("name", name.trim());
    if (![...params.keys()].length) return setDups([]);
    dupTimer.current = setTimeout(async () => {
      setDupChecking(true);
      try {
        const res = await fetchWithAuth(`${API}/suggest?${params}`);
        if (res.ok) setDups(await res.json());
      } catch { /* advisory only */ }
      finally { setDupChecking(false); }
    }, 400);
  }, []);

  const register = async () => {
    const problem = checkCustomer(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, LeadId: form.LeadId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.existingCustomerId) {
          setDups((prev) => (prev.some((d) => d.Id === data.existingCustomerId) ? prev : [{ Id: data.existingCustomerId, _error: data.error }, ...prev]));
          return void toast.warning("A matching customer already exists; see below.");
        }
        throw new Error(data.error || "Could not register the customer.");
      }
      toast.success(`Customer ${data.CustomerNo} registered`);
      ["crm-customers", "crm-customers-counts", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
              <UserPlus size={18} />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold leading-tight">New customer</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Register an identity profile from a converted lead or as a walk-in customer.
              </p>
            </div>
          </div>
        </DialogHeader>

        <CustBlock title="Link converted lead" icon={<Sparkles size={14} className="text-primary" />} note="Optional">
          <CustField label="Select converted lead">
            <SearchableSelect
              value={form.LeadId}
              onChange={pickLead}
              placeholder={loadingLeads ? "Loading leads…" : "Walk-in / new customer"}
              searchPlaceholder="Search name, mobile or lead code…"
              options={[
                { value: "", label: "Walk-in / new customer" },
                ...leads.map((l) => ({ value: String(l.Id), label: [l.CustomerName, l.Mobile, l.LeadUid].filter(Boolean).join(" · ") })),
              ]}
            />
          </CustField>
          {form.LeadId && (
            <p className="text-xs text-muted-foreground">Name, mobile numbers and email prefilled from lead.</p>
          )}
        </CustBlock>

        <CustomerFields
          form={form}
          setForm={setForm}
          onIdentityBlur={(k) => (k === "Mobile" || k === "PanNo") && checkDuplicates(form.Mobile, form.PanNo, form.CustomerName)}
        />

        {(dupChecking || dups.length > 0) && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-destructive/25 text-xs font-semibold text-destructive flex items-center gap-1.5">
              <AlertTriangle size={13} />
              {dupChecking
                ? "Checking for possible duplicates…"
                : `${dups.length} possible duplicate${dups.length > 1 ? "s" : ""} found — review before registering`}
            </div>
            <div className="divide-y divide-destructive/20">
              {dups.map((d) => (
                <div key={d.Id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs bg-card">
                  <div className="min-w-0">
                    {d._error ? (
                      <p className="text-destructive font-medium">{d._error}</p>
                    ) : (
                      <>
                        <p className="font-semibold text-foreground truncate">
                          {d.CustomerName}
                          <span className="font-normal text-muted-foreground font-mono"> · {d.CustomerNo}</span>
                        </p>
                        <p className="text-muted-foreground">
                          {[d.Mobile, d.PanNo, d.PermanentCity].filter(Boolean).join(" · ")}
                          {d.ApplicationCount > 0 ? ` · ${d.ApplicationCount} application${d.ApplicationCount > 1 ? "s" : ""}` : ""}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => { onClose(); onOpenCustomer(d.Id); }} className={`${CUST_KEY_LINE} h-7 px-2.5 text-foreground`}>
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => setDups((p) => p.filter((x) => x.Id !== d.Id))}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button type="button" onClick={onClose} className={`${CUST_KEY_LINE} h-9 px-4 text-foreground`}>Cancel</button>
          <button type="button" onClick={register} disabled={saving} className={`${CUST_KEY_INK} h-9 px-4`}>
            {saving ? "Registering…" : "Register customer"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
