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
import {
  Plus, Trash2, Scale, Loader2, RefreshCw,
  CheckCircle2, Clock, FileText, AlertCircle, Search, X, Check,
} from "lucide-react";
import {
  getJournalVouchers,
  createJournalVoucher,
  approveJournalVoucher,
  rejectJournalVoucher,
  type JournalVoucherSummary,
  type JournalVoucherLine,
} from "@/api/journalVoucherApi";
import { getLedgerOptions, type LedgerOption } from "@/api/generalLedgerApi";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";

type JournalVoucherLineUI = JournalVoucherLine & { _id: string };
const emptyLine = (): JournalVoucherLineUI => ({
  _id: crypto.randomUUID(),
  LHeadId: null,
  DebitAmount: 0,
  CreditAmount: 0,
  Narration: "",
});

const STATUS_CFG: Record<string, { cls: string; dot: string; icon: React.ElementType }> = {
  Draft:    { cls: "bg-slate-500/10 text-slate-500 border-slate-400/20",   dot: "bg-slate-400",   icon: FileText },
  Pending:  { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",   dot: "bg-amber-400",   icon: Clock },
  Approved: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20", dot: "bg-emerald-500", icon: CheckCircle2 },
  Rejected: { cls: "bg-rose-500/10 text-rose-600 border-rose-400/20",     dot: "bg-rose-500",    icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.Draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border", cfg.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {status}
    </span>
  );
}

function GLBadge({ status, postedToGL }: { status: string; postedToGL?: boolean }) {
  if (status !== "Approved") {
    return <span className="text-muted-foreground text-xs">--</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
        postedToGL
          ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20"
          : "bg-rose-500/10 text-rose-600 border-rose-400/20",
      )}
    >
      {postedToGL ? "Posted" : "Not posted"}
    </span>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function JournalVoucher() {
  const rights = usePageRights("journal-voucher");
  const [vouchers, setVouchers] = useState<JournalVoucherSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerOptions, setLedgerOptions] = useState<LedgerOption[]>([]);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jvDate, setJvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<JournalVoucherLineUI[]>([emptyLine(), emptyLine()]);

  const [actingId, setActingId] = useState<number | null>(null);

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
    getLedgerOptions().then(setLedgerOptions).catch(() => setLedgerOptions([]));
  }, []);

  const totals = useMemo(() => {
    const debit  = lines.reduce((s, l) => s + (Number(l.DebitAmount)  || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<JournalVoucherLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addLine    = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const resetForm = () => {
    setJvDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setLines([emptyLine(), emptyLine()]);
  };

  const handleApprove = async (id: number) => {
    setActingId(id);
    try {
      await approveJournalVoucher(id);
      toast.success("Journal Voucher approved and posted to GL");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Approval failed");
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: number) => {
    setActingId(id);
    try {
      await rejectJournalVoucher(id);
      toast.success("Journal Voucher rejected");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Rejection failed");
    } finally {
      setActingId(null);
    }
  };

  const submit = async () => {
    if (!totals.balanced) { toast.error("Debit and Credit totals must match before saving."); return; }
    if (lines.some((l) => !l.LHeadId)) { toast.error("Every line requires an account head."); return; }
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

  // Stats
  const stats = useMemo(() => ({
    total:    vouchers.length,
    approved: vouchers.filter((v) => v.Status === "Approved").length,
    pending:  vouchers.filter((v) => v.Status === "Pending").length,
    draft:    vouchers.filter((v) => v.Status === "Draft").length,
  }), [vouchers]);

  // Filtered list
  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = search.toLowerCase();
    return vouchers.filter(
      (v) =>
        (v.JVNo || "").toLowerCase().includes(q) ||
        (v.Narration || "").toLowerCase().includes(q) ||
        (v.Status || "").toLowerCase().includes(q),
    );
  }, [vouchers, search]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Journal Voucher"]} />
      <FinanceShell
        title="Journal Voucher"
        subtitle="Correct account-head mismatches with balanced multi-line entries"
        icon={Scale}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && (
              <button
                onClick={() => setDialogOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg gradient-accent text-white text-sm font-semibold transition-all"
              >
                <Plus size={14} />
                New Journal Voucher
              </button>
            )}
          </div>
        }
      >

        {/* ── Stat pills ── */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total",    value: stats.total,    color: "text-foreground",     bg: "bg-muted/30",          icon: FileText },
              { label: "Approved", value: stats.approved, color: "text-emerald-600",    bg: "bg-emerald-500/5",     icon: CheckCircle2 },
              { label: "Pending",  value: stats.pending,  color: "text-amber-600",      bg: "bg-amber-500/5",       icon: Clock },
              { label: "Draft",    value: stats.draft,    color: "text-slate-500",      bg: "bg-slate-500/5",       icon: FileText },
            ].map(({ label, value, color, bg, icon: Icon }) => (
              <div key={label} className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border border-border", bg)}>
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
                  <Icon size={14} className={color} />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground leading-none">{value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Search ── */}
        <div className="relative mb-4">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by JV number, narration, or status…"
            className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">JV No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Narration</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">GL</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">Loading vouchers…</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Scale size={36} className="opacity-20" />
                      <p className="text-sm font-medium">
                        {search ? "No vouchers match your search" : "No journal vouchers yet"}
                      </p>
                      {search && (
                        <button onClick={() => setSearch("")} className="text-xs text-primary hover:underline">
                          Clear search
                        </button>
                      )}
                      {!search && rights.canCreate && (
                        <button
                          onClick={() => setDialogOpen(true)}
                          className="flex items-center gap-1.5 mt-1 px-4 py-2 rounded-lg gradient-accent text-white text-xs font-semibold"
                        >
                          <Plus size={12} /> Create First Voucher
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((v) => (
                  <tr key={v.JVID} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {v.JVNo || `JV-${v.JVID}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(v.JVDate)}</td>
                    <td className="px-4 py-3 text-sm text-foreground max-w-xs">
                      <p className="truncate">{v.Narration || <span className="italic text-muted-foreground/50">—</span>}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                      {formatINR(v.TotalAmount || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v.Status} />
                    </td>
                    <td className="px-4 py-3">
                      <GLBadge status={v.Status} postedToGL={v.PostedToGL} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {v.Status === "Pending" && rights.canEdit && (
                        <div className="flex justify-end gap-1">
                          <button
                            disabled={actingId === v.JVID}
                            onClick={() => handleApprove(v.JVID)}
                            title="Approve"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                          >
                            {actingId === v.JVID ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                          </button>
                          <button
                            disabled={actingId === v.JVID}
                            onClick={() => handleReject(v.JVID)}
                            title="Reject"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && search && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {vouchers.length} vouchers
              </p>
            </div>
          )}
        </div>
      </FinanceShell>

      {/* ── New JV Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Scale size={15} className="text-primary" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold">New Journal Voucher</DialogTitle>
                <DialogDescription className="text-[11px] mt-0.5">
                  Debit total must equal credit total before saving.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Date</label>
                <Input type="date" value={jvDate} onChange={(e) => setJvDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Narration</label>
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for this correction" />
              </div>
            </div>

            {/* Lines */}
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Account Head</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-32">Debit</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-32">Credit</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, idx) => (
                    <tr key={line._id} className="group hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <Select
                          value={line.LHeadId ? String(line.LHeadId) : ""}
                          onValueChange={(v) => updateLine(idx, { LHeadId: parseInt(v, 10) })}
                        >
                          <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0 px-0">
                            <SelectValue placeholder="Select account…" />
                          </SelectTrigger>
                          <SelectContent>
                            {ledgerOptions.map((opt) => (
                              <SelectItem key={opt.id} value={String(opt.id)} className="text-xs">{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={line.DebitAmount || ""}
                          onChange={(e) => updateLine(idx, { DebitAmount: parseFloat(e.target.value) || 0, CreditAmount: 0 })}
                          className="h-8 text-xs text-right border-0 bg-transparent focus-visible:ring-0 px-0"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={line.CreditAmount || ""}
                          onChange={(e) => updateLine(idx, { CreditAmount: parseFloat(e.target.value) || 0, DebitAmount: 0 })}
                          className="h-8 text-xs text-right border-0 bg-transparent focus-visible:ring-0 px-0"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          disabled={lines.length <= 2}
                          onClick={() => removeLine(idx)}
                          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/20">
                  <tr>
                    <td className="px-3 py-2">
                      <button onClick={addLine} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Plus size={11} /> Add line
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatINR(totals.debit)}</td>
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatINR(totals.credit)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Balance indicator */}
            <div className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium",
              totals.balanced
                ? "border-emerald-400/30 bg-emerald-500/5 text-emerald-600"
                : totals.debit > 0 || totals.credit > 0
                ? "border-rose-400/30 bg-rose-500/5 text-rose-600"
                : "border-border bg-muted/20 text-muted-foreground"
            )}>
              {totals.balanced
                ? <CheckCircle2 size={13} />
                : totals.debit > 0 || totals.credit > 0
                ? <AlertCircle size={13} />
                : <Scale size={13} />}
              {totals.balanced
                ? `Balanced — ${formatINR(totals.debit)} each side`
                : totals.debit > 0 || totals.credit > 0
                ? `Difference: ${formatINR(Math.abs(totals.debit - totals.credit))}`
                : "Enter amounts on each line"}
            </div>
          </div>

          <DialogFooter className="px-5 py-3.5 border-t border-border">
            <button
              onClick={() => { setDialogOpen(false); resetForm(); }}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !totals.balanced}
              className="flex items-center gap-2 px-5 py-2 rounded-lg gradient-accent text-white text-sm font-semibold transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {saving ? "Saving…" : "Save & Submit"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}