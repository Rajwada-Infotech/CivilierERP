import React from "react";
import { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Scale, Loader2, RefreshCw } from "lucide-react";
import {
  getJournalVouchers,
  createJournalVoucher,
  type JournalVoucherSummary,
  type JournalVoucherLine,
} from "@/api/journalVoucherApi";
import { getLedgerOptions, type LedgerOption } from "@/api/generalLedgerApi";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";

const emptyLine = (): JournalVoucherLine => ({
  LHeadId: null,
  DebitAmount: 0,
  CreditAmount: 0,
  Narration: "",
});

const STATUS_STYLES: Record<string, string> = {
  Draft: "bg-slate-500/15 text-slate-400",
  Pending: "bg-amber-500/15 text-amber-400",
  Approved: "bg-emerald-500/15 text-emerald-400",
  Rejected: "bg-rose-500/15 text-rose-400",
};

export default function JournalVoucher() {
  const rights = usePageRights("journal-voucher");
  const [vouchers, setVouchers] = useState<JournalVoucherSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerOptions, setLedgerOptions] = useState<LedgerOption[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jvDate, setJvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<JournalVoucherLine[]>([emptyLine(), emptyLine()]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getJournalVouchers();
      setVouchers(data);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load journal vouchers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getLedgerOptions()
      .then(setLedgerOptions)
      .catch(() => setLedgerOptions([]));
  }, []);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.DebitAmount) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<JournalVoucherLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const resetForm = () => {
    setJvDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setLines([emptyLine(), emptyLine()]);
  };

  const submit = async () => {
    if (!totals.balanced) {
      toast.error("Debit and Credit totals must match before saving.");
      return;
    }
    if (lines.some((l) => !l.LHeadId)) {
      toast.error("Every line requires an account head.");
      return;
    }
    setSaving(true);
    try {
      await createJournalVoucher({ JVDate: jvDate, Narration: narration, lines });
      toast.success("Journal Voucher created and submitted for approval");
      setDialogOpen(false);
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create Journal Voucher");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FinanceShell
      title="Journal Voucher"
      subtitle="Forcefully correct account-head mismatches with a balanced multi-line entry"
      icon={Scale}
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          {rights.canCreate && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Journal Voucher
            </Button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={["Dashboard", "Finance", "Journal Voucher"]} />

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left">
            <tr>
              <th className="px-4 py-2">JV No</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Narration</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
                </td>
              </tr>
            ) : vouchers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No journal vouchers yet.
                </td>
              </tr>
            ) : (
              vouchers.map((v) => (
                <tr key={v.JVID} className="border-t border-white/5">
                  <td className="px-4 py-2 font-mono">{v.JVNo || `JV-${v.JVID}`}</td>
                  <td className="px-4 py-2">{v.JVDate?.slice(0, 10)}</td>
                  <td className="px-4 py-2">{v.Narration || "—"}</td>
                  <td className="px-4 py-2 text-right">{formatINR(v.TotalAmount || 0)}</td>
                  <td className="px-4 py-2">
                    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", STATUS_STYLES[v.Status])}>
                      {v.Status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Journal Voucher</DialogTitle>
            <DialogDescription>
              Add balanced debit/credit lines. Total debit must equal total credit before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Date</label>
                <Input type="date" value={jvDate} onChange={(e) => setJvDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Narration</label>
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for this correction" />
              </div>
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <Select
                      value={line.LHeadId ? String(line.LHeadId) : ""}
                      onValueChange={(v) => updateLine(idx, { LHeadId: parseInt(v, 10) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Account head" />
                      </SelectTrigger>
                      <SelectContent>
                        {ledgerOptions.map((opt) => (
                          <SelectItem key={opt.id} value={String(opt.id)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Input
                      type="number"
                      placeholder="Debit"
                      value={line.DebitAmount || ""}
                      onChange={(e) =>
                        updateLine(idx, { DebitAmount: parseFloat(e.target.value) || 0, CreditAmount: 0 })
                      }
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      type="number"
                      placeholder="Credit"
                      value={line.CreditAmount || ""}
                      onChange={(e) =>
                        updateLine(idx, { CreditAmount: parseFloat(e.target.value) || 0, DebitAmount: 0 })
                      }
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={lines.length <= 2}
                      onClick={() => removeLine(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> Add Line
              </Button>
            </div>

            <div className="flex justify-between text-sm px-1">
              <span>Total Debit: <strong>{formatINR(totals.debit)}</strong></span>
              <span>Total Credit: <strong>{formatINR(totals.credit)}</strong></span>
              <span className={totals.balanced ? "text-emerald-400" : "text-rose-400"}>
                {totals.balanced ? "Balanced" : "Not balanced"}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || !totals.balanced}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save & Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FinanceShell>
  );
}
