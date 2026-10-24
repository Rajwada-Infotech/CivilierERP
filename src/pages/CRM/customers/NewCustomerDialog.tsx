// New customer: optionally from a converted lead (its name, mobiles and email fill in), with a duplicate check on
// mobile, PAN and name as they are entered. A 409 from the server (same mobile / PAN / lead) shows the existing record.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { API, EMPTY_FORM, Field, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, checkCustomer, fetchLeadPool, type CustomerForm } from "./config";
import { CustomerFields } from "./CustomerFields";

export function NewCustomerDialog({ leadId, onClose, onOpenCustomer }: { leadId: string | null; onClose: () => void; onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CustomerForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [dups, setDups] = useState<any[]>([]);
  const [dupChecking, setDupChecking] = useState(false);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: pool = [], isLoading: loadingLeads } = useQuery({ queryKey: ["crm-leads-pool"], queryFn: fetchLeadPool, staleTime: 30_000 });
  const leads = pool.filter((l) => !l.CustomerId);

  const pickLead = (id: string) => {
    const lead = leads.find((l) => String(l.Id) === id);
    setForm((f) => (lead
      ? { ...f, LeadId: id, CustomerName: lead.CustomerName || "", Mobile: lead.Mobile || "", AltMobile: lead.AltMobile || "", Email: lead.Email || "" }
      : { ...f, LeadId: "" }));
  };
  // Opened from CRM Leads' "Create customer" (?leadId=X): pick that lead once the pool is in.
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
      } catch { /* the check only advises */ }
      finally { setDupChecking(false); }
    }, 400);
  }, []);

  const register = async () => {
    const problem = checkCustomer(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, LeadId: form.LeadId || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.existingCustomerId) {
          setDups((prev) => (prev.some((d) => d.Id === data.existingCustomerId) ? prev : [{ Id: data.existingCustomerId, _error: data.error }, ...prev]));
          return void toast.warning("A matching customer already exists; see below.");
        }
        throw new Error(data.error || "Could not register the customer.");
      }
      toast.success(`Customer ${data.CustomerNo} registered`);
      ["crm-customers", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">
            <UserPlus size={14} /> New customer
          </DialogTitle>
        </DialogHeader>

        <Field label="From a converted lead (optional)">
          <SearchableSelect
            value={form.LeadId}
            onChange={pickLead}
            placeholder={loadingLeads ? "Loading leads…" : "Walk-in / new customer"}
            searchPlaceholder="Search name, mobile or lead code…"
            options={[{ value: "", label: "Walk-in / new customer" }, ...leads.map((l) => ({ value: String(l.Id), label: [l.CustomerName, l.Mobile, l.LeadUid].filter(Boolean).join(" · ") }))]}
          />
        </Field>
        {form.LeadId && <p className="text-xs text-muted-foreground -mt-2">Name, mobiles and email filled in from the lead.</p>}

        <CustomerFields
          form={form}
          setForm={setForm}
          onIdentityBlur={(k) => (k === "Mobile" || k === "PanNo") && checkDuplicates(form.Mobile, form.PanNo, form.CustomerName)}
        />

        {(dupChecking || dups.length > 0) && (
          <div className="bg-card" style={{ border: "1px solid hsl(var(--destructive) / 0.6)" }}>
            <p className={`${LBL} !text-destructive px-4 py-2.5 flex items-center gap-1.5`} style={{ borderBottom: RULE_SOFT }}>
              <AlertTriangle size={12} /> {dupChecking ? "Checking for duplicates…" : `${dups.length} possible duplicate${dups.length > 1 ? "s" : ""}: check before registering`}
            </p>
            {dups.map((d) => (
              <div key={d.Id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs" style={{ borderBottom: RULE_SOFT }}>
                <div className="min-w-0">
                  {d._error ? <p className="text-destructive font-medium">{d._error}</p> : (
                    <>
                      <p className="font-semibold text-foreground truncate">{d.CustomerName} <span className="font-normal text-muted-foreground font-heading tabular-nums">· {d.CustomerNo}</span></p>
                      <p className="text-muted-foreground">{[d.Mobile, d.PanNo, d.PermanentCity].filter(Boolean).join(" · ")}{d.ApplicationCount > 0 ? ` · ${d.ApplicationCount} application${d.ApplicationCount > 1 ? "s" : ""}` : ""}</p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { onClose(); onOpenCustomer(d.Id); }} className={`${KEY_LINE} h-7 px-2.5`}>Open</button>
                  <button onClick={() => setDups((p) => p.filter((x) => x.Id !== d.Id))} className="p-1 text-muted-foreground hover:text-foreground" title="Dismiss"><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={register} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Registering…" : "Register customer"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
