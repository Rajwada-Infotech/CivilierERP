import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { DbaShell } from "@/components/dba/DbaShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Download,
  Eye,
  Smartphone,
  Building2,
  CreditCard,
  IndianRupee,
  QrCode,
  RefreshCw,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type PaymentMethod = "upi" | "neft" | "rtgs" | "imps" | "bank_transfer";
type PaymentStatus = "success" | "pending" | "failed" | "refunded";

interface PaymentLog {
  id: string;
  txnId: string;
  tenantId: string;
  tenantName: string;
  amount: number;
  method: PaymentMethod;
  upiId?: string;
  bankRef?: string;
  paidBy: string;
  paidOn: string;
  paidAt: string;
  status: PaymentStatus;
  purpose: string;
  plan: string;
  renewalPeriod: string;
  remarks: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const METHOD_CONFIG: Record<
  PaymentMethod,
  { label: string; color: string; icon: typeof Smartphone }
> = {
  upi: {
    label: "UPI",
    color: "bg-violet-500/15 text-violet-600 border-violet-500/30",
    icon: QrCode,
  },
  neft: {
    label: "NEFT",
    color: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    icon: Building2,
  },
  rtgs: {
    label: "RTGS",
    color: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
    icon: CreditCard,
  },
  imps: {
    label: "IMPS",
    color: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
    icon: Smartphone,
  },
  bank_transfer: {
    label: "Bank Transfer",
    color: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    icon: Building2,
  },
};

const STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  success: {
    label: "Success",
    color: "bg-green-500/15 text-green-600 border-green-500/30",
    icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    color: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
    icon: Clock,
  },
  failed: {
    label: "Failed",
    color: "bg-red-500/15 text-red-600 border-red-500/30",
    icon: XCircle,
  },
  refunded: {
    label: "Refunded",
    color: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    icon: RefreshCw,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PaymentLogs() {
  usePageRights("dba-payment-logs");
  const { data: logs = [] } = useQuery<PaymentLog[]>({
    queryKey: ["dba-payment-logs"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/payment-logs");
      if (!res.ok) throw new Error("Failed to load payment logs");
      const rows = await res.json().catch(() => ({}));
      // Normalize DB snake_case → component shape
      return rows.map((r: any) => ({
        id: String(r.Id),
        txnId: r.txn_id,
        tenantId: r.tenant_id ?? "",
        tenantName: r.tenant_name ?? "",
        amount: Number(r.amount),
        method: r.method as PaymentMethod,
        upiId: r.upi_id ?? undefined,
        bankRef: r.bank_ref ?? undefined,
        paidBy: r.paid_by ?? "",
        paidOn: r.paid_on ? r.paid_on.split("T")[0] : "",
        paidAt: r.paid_on
          ? new Date(r.paid_on).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        status: r.status as PaymentStatus,
        purpose: r.purpose ?? "",
        plan: r.plan ?? "",
        renewalPeriod: r.renewal_period ?? "—",
        remarks: r.remarks ?? "",
      }));
    },
  });

  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    txn_id: "", tenant_id: "", tenant_name: "", amount: "",
    method: "upi", upi_id: "", bank_ref: "", paid_by: "",
    paid_on: "", status: "pending", purpose: "", plan: "",
    renewal_period: "", remarks: "",
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/dba/payment-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addForm, amount: parseFloat(addForm.amount) || 0 }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dba-payment-logs"] });
      setAddOpen(false);
      setAddForm({ txn_id: "", tenant_id: "", tenant_name: "", amount: "", method: "upi", upi_id: "", bank_ref: "", paid_by: "", paid_on: "", status: "pending", purpose: "", plan: "", renewal_period: "", remarks: "" });
    },
  });

  const [selected, setSelected] = useState<PaymentLog | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");

  const filtered = logs.filter((l) => {
    const matchSearch =
      !search ||
      l.tenantName.toLowerCase().includes(search.toLowerCase()) ||
      l.txnId.toLowerCase().includes(search.toLowerCase()) ||
      l.paidBy.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || l.status === filterStatus;
    const matchMethod = filterMethod === "all" || l.method === filterMethod;
    return matchSearch && matchStatus && matchMethod;
  });

  const totalReceived = logs
    .filter((l) => l.status === "success")
    .reduce((s, l) => s + l.amount, 0);
  const pendingAmount = logs
    .filter((l) => l.status === "pending")
    .reduce((s, l) => s + l.amount, 0);
  const successCount = logs.filter((l) => l.status === "success").length;
  const upiPayments = logs
    .filter((l) => l.method === "upi" && l.status === "success")
    .reduce((s, l) => s + l.amount, 0);

  return (
    <div className="max-w-[1400px] mx-auto">
      <Breadcrumbs items={[{ label: "DBA Console" }, { label: "Logs" }]} />

      <DbaShell
        title="Payment Logs"
        subtitle="All received payments via UPI, NEFT, RTGS, IMPS"
        icon={Receipt}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Download size={12} /> Export CSV
            </Button>
            <Button size="sm" className="gap-1.5 text-xs gradient-accent" onClick={() => setAddOpen(true)}>
              <Plus size={12} /> Add Log
            </Button>
          </div>
        }
      >
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Total Received",
            value: `₹${(totalReceived / 1000).toFixed(0)}K`,
            icon: IndianRupee,
            color: "text-green-500",
            bg: "bg-green-500/10",
          },
          {
            label: "Pending",
            value: `₹${(pendingAmount / 1000).toFixed(0)}K`,
            icon: Clock,
            color: "text-yellow-500",
            bg: "bg-yellow-500/10",
          },
          {
            label: "Successful Txns",
            value: successCount,
            icon: CheckCircle2,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
          },
          {
            label: "UPI Collections",
            value: `₹${(upiPayments / 1000).toFixed(0)}K`,
            icon: QrCode,
            color: "text-violet-500",
            bg: "bg-violet-500/10",
          },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon size={15} className={s.color} />
              </div>
              <div>
                <div className="text-lg font-bold leading-none">{s.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {s.label}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="text-xs h-8 pl-7"
            placeholder="Search tenant, TXN ID, payer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="text-xs h-8 w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              All Status
            </SelectItem>
            <SelectItem value="success" className="text-xs">
              Success
            </SelectItem>
            <SelectItem value="pending" className="text-xs">
              Pending
            </SelectItem>
            <SelectItem value="failed" className="text-xs">
              Failed
            </SelectItem>
            <SelectItem value="refunded" className="text-xs">
              Refunded
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterMethod} onValueChange={setFilterMethod}>
          <SelectTrigger className="text-xs h-8 w-32">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              All Methods
            </SelectItem>
            <SelectItem value="upi" className="text-xs">
              UPI
            </SelectItem>
            <SelectItem value="neft" className="text-xs">
              NEFT
            </SelectItem>
            <SelectItem value="rtgs" className="text-xs">
              RTGS
            </SelectItem>
            <SelectItem value="imps" className="text-xs">
              IMPS
            </SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {logs.length} records
        </span>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt size={14} className="text-emerald-500" /> Transaction
            Ledger
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>TXN ID</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Paid By</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((log) => {
                  const MC = METHOD_CONFIG[log.method];
                  const SC = STATUS_CONFIG[log.status];
                  return (
                    <TableRow key={log.id} className="text-xs">
                      <TableCell>
                        <span className="font-mono text-[10px] text-primary bg-muted px-1.5 py-0.5 rounded">
                          {log.txnId.slice(0, 18)}…
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-[11px]">
                          {log.tenantName}
                        </div>
                        <div className="text-muted-foreground text-[10px] font-mono">
                          {log.tenantId}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`font-bold text-sm ${log.status === "success" ? "text-emerald-600" : log.status === "refunded" ? "text-slate-500 line-through" : "text-foreground"}`}
                        >
                          ₹{log.amount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] gap-1 ${MC.color}`}>
                          <MC.icon size={9} /> {MC.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px]">{log.paidBy}</div>
                        {log.upiId && (
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {log.upiId}
                          </div>
                        )}
                        {log.bankRef && (
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {log.bankRef}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-[10px]">
                          {log.paidOn}
                        </div>
                        <div className="text-muted-foreground text-[10px]">
                          {log.paidAt}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px]">{log.purpose}</div>
                        <div className="text-muted-foreground text-[10px]">
                          {log.plan} · {log.renewalPeriod}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] gap-1 ${SC.color}`}>
                          <SC.icon size={9} /> {SC.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            setSelected(log);
                            setDetailOpen(true);
                          }}
                        >
                          <Eye size={11} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </DbaShell>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Receipt size={14} className="text-emerald-500" /> Payment Receipt
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-1">
              {/* Receipt header */}
              <div
                className={`rounded-lg p-3 text-center ${STATUS_CONFIG[selected.status].color} border`}
              >
                <StatusIcon status={selected.status} />
                <div className="text-2xl font-bold mt-1">
                  ₹{selected.amount.toLocaleString()}
                </div>
                <div className="text-xs font-medium">
                  {STATUS_CONFIG[selected.status].label}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                {[
                  { label: "TXN ID", value: selected.txnId, mono: true },
                  { label: "Tenant", value: selected.tenantName },
                  { label: "Paid By", value: selected.paidBy },
                  {
                    label: "Method",
                    value: METHOD_CONFIG[selected.method].label,
                  },
                  selected.upiId
                    ? { label: "UPI ID", value: selected.upiId, mono: true }
                    : null,
                  selected.bankRef
                    ? { label: "Bank Ref", value: selected.bankRef, mono: true }
                    : null,
                  {
                    label: "Date",
                    value: `${selected.paidOn} at ${selected.paidAt}`,
                  },
                  { label: "Purpose", value: selected.purpose },
                  { label: "Plan", value: selected.plan },
                  { label: "Renewal Period", value: selected.renewalPeriod },
                  { label: "Remarks", value: selected.remarks },
                ]
                  .filter(Boolean)
                  .map((row: any, i) => (
                    <div
                      key={i}
                      className="flex justify-between gap-3 py-1 border-b border-dashed border-muted last:border-0"
                    >
                      <span className="text-muted-foreground shrink-0">
                        {row.label}
                      </span>
                      <span
                        className={`text-right ${row.mono ? "font-mono text-[10px]" : ""}`}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDetailOpen(false)}
            >
              Close
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1"
              onClick={() => {
                setDetailOpen(false);
              }}
            >
              <Download size={11} /> Download Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Payment Log Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Plus size={14} className="text-emerald-500" /> Add Payment Log
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2 text-xs">
            {[
              { key: "txn_id", label: "TXN ID *", placeholder: "TXN123456" },
              { key: "tenant_name", label: "Tenant Name", placeholder: "Acme Corp" },
              { key: "tenant_id", label: "Tenant ID", placeholder: "tenant_abc" },
              { key: "amount", label: "Amount (₹) *", placeholder: "5000", type: "number" },
              { key: "paid_by", label: "Paid By", placeholder: "John Doe" },
              { key: "paid_on", label: "Paid On", type: "date" },
              { key: "upi_id", label: "UPI ID", placeholder: "name@upi" },
              { key: "bank_ref", label: "Bank Ref", placeholder: "REF123" },
              { key: "purpose", label: "Purpose", placeholder: "Subscription renewal" },
              { key: "plan", label: "Plan", placeholder: "Pro" },
              { key: "renewal_period", label: "Renewal Period", placeholder: "Annual" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key} className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
                <Input
                  className="h-7 text-xs"
                  type={type || "text"}
                  placeholder={placeholder}
                  value={(addForm as any)[key]}
                  onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Method</label>
              <Select value={addForm.method} onValueChange={(v) => setAddForm((p) => ({ ...p, method: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["upi","neft","rtgs","imps","bank_transfer"].map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{m.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status</label>
              <Select value={addForm.status} onValueChange={(v) => setAddForm((p) => ({ ...p, status: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pending","success","failed","refunded"].map((s) => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Remarks</label>
              <Input
                className="h-7 text-xs"
                placeholder="Optional notes"
                value={addForm.remarks}
                onChange={(e) => setAddForm((p) => ({ ...p, remarks: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="text-xs gradient-accent"
              disabled={!addForm.txn_id || !addForm.amount || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? "Saving…" : "Save Log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusIcon({ status }: { status: PaymentStatus }) {
  const icons = {
    success: <CheckCircle2 size={24} className="mx-auto text-green-600" />,
    pending: <Clock size={24} className="mx-auto text-yellow-600" />,
    failed: <XCircle size={24} className="mx-auto text-red-600" />,
    refunded: <RefreshCw size={24} className="mx-auto text-slate-500" />,
  };
  return icons[status];
}
