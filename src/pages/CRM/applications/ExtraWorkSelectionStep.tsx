// Wizard step: extra charges.
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Trash2, IndianRupee, Lock, Wallet } from "lucide-react";
import { useGstRates, computeExtraWorkGst, fmtInr } from "@/lib/crmGst";
import { EXTRA_CHARGE_API, KEY_INK } from "./config";

// ── Step 3: Extra Charges ──────────────────────────────────────────────────────────
// Unlike Parking (Step 2), Extra Charges is never tied to a scarce/exclusive
// resource — no physical slot to hold — so items added here are real
// dbo.CrmExtraCharge rows straight away (ApplicationId set, BookingId NULL),
// not a hold-then-convert flow. Non-mandatory, exactly like Parking. Locked
// the same Draft/Pending way Parking is (canEdit prop, identical gate on the
// backend) — free to add/remove pre-approval, frozen once Approved.
export const ExtraWorkSelectionStep: React.FC<{
  applicationId: number;
  computedTotal: number;
  canEdit: boolean;
  wizardAppStatus: string | null;
}> = ({ applicationId, computedTotal, canEdit, wizardAppStatus }) => {
  const { data: charges = [], refetch } = useQuery({
    queryKey: ["crm-app-extra-charges", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${EXTRA_CHARGE_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
  });
  const { data: rates } = useGstRates();

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(false);

  const chargesTotal = (charges as any[]).reduce((s, c) => s + (Number(c.TotalAmount) || 0), 0);

  const handleAdd = async () => {
    if (!description.trim()) { toast.error("Description is required"); return; }
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setAdding(true);
    try {
      const res = await fetchWithAuth(`${EXTRA_CHARGE_API}/application/${applicationId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Description: description.trim(), Amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add extra work");
      toast.success(`${description.trim()} added — ${fmtInr(data.TotalAmount)}`);
      setDescription(""); setAmount("");
      refetch();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${EXTRA_CHARGE_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetch();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const preview = amount && Number(amount) > 0 && rates ? computeExtraWorkGst(Number(amount), rates) : null;

  return (
    <div className="space-y-4">
      <div className=" border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
        <IndianRupee size={11} className="text-primary shrink-0" />
        Unit {fmtInr(computedTotal)}
        {chargesTotal > 0 && ` + Extra Charges ${fmtInr(chargesTotal)}`}
        {" — Extra Charges is optional and never affects the Unit+Parking GST bracket, only its own fixed 18% (HSN Master)."}
      </div>

      <div className=" border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Wallet size={13} /> Extra Charges</label>
          {!canEdit && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              <Lock size={11} /> {wizardAppStatus === "Approved" ? "Manage from Booking" : `Locked (${wizardAppStatus})`}
            </span>
          )}
        </div>
        {!canEdit && wizardAppStatus === "Approved" && (
          <p className="text-[0.6875rem] text-muted-foreground bg-muted/30 px-3 py-2">
            This application has a Booking — add or edit extra charges from the Booking's <strong>Parking &amp; Extra Charges</strong> tab.
          </p>
        )}
        {(charges as any[]).length > 0 ? (
          <div className="space-y-1.5">
            {(charges as any[]).map((c: any) => (
              <div key={c.Id} className="flex items-center justify-between text-xs bg-muted/30 px-2.5 py-1.5">
                <span>{c.Description} · {fmtInr(c.Amount)} + GST {fmtInr(c.GstAmount)} = <span className="font-medium">{fmtInr(c.TotalAmount)}</span></span>
                {canEdit && (
                  <button onClick={() => handleRemove(c.Id)} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No extra work added yet — optional.</p>
        )}
      </div>

      {canEdit && (
        <div className=" border border-border p-3 space-y-2">
          <input placeholder="Description (e.g. Modular Kitchen)" value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
          <input type="number" placeholder="Amount" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
          {preview && (
            <div className="flex items-center justify-between border border-foreground/30 bg-card px-3 py-2 text-xs text-foreground">
              <span>GST ({preview.rate}%, fixed — HSN Master)</span>
              <span className="font-semibold">{fmtInr(preview.gstAmount)} → Total {fmtInr(preview.total)}</span>
            </div>
          )}
          <button onClick={handleAdd} disabled={adding || !description.trim() || !amount}
            className={`${KEY_INK} h-9 px-4`}>
            {adding ? "Adding..." : "Add Extra Charges"}
          </button>
        </div>
      )}
    </div>
  );
};
