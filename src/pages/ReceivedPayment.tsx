import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  Plus,
  CalendarIcon,
  ArrowDownCircle,
  CheckCircle2,
  Clock,
  IndianRupee,
  Building2,
  Banknote,
  CreditCard,
  Smartphone,
  FileText,
  Trash2,
} from "lucide-react";

export type ReceivedPayment = {
  id: string;
  receivedFrom: string;
  projectName: string;
  docDate: string;
  mode: "Cash" | "Check" | "UPI" | "NEFT" | "RTGS" | "Card";
  amount: number;
  bankName?: string;
  transactionId?: string;
  checkNumber?: string;
  remarks?: string;
  status: "pending" | "cleared";
  createdAt: string;
};

const MOCK_PROJECTS = [
  "Project Alpha",
  "Site Beta",
  "Commercial Tower",
  "Residential Complex",
  "Infrastructure Project",
  "Road Construction",
  "Bridge Project",
  "Gamma Residential",
];

const PAYMENT_MODES = ["Cash", "Check", "UPI", "NEFT", "RTGS", "Card"] as const;

const modeIcon = (mode: string) => {
  if (mode === "Cash") return <Banknote size={13} className="text-emerald-500" />;
  if (mode === "Check") return <FileText size={13} className="text-blue-500" />;
  if (mode === "UPI") return <Smartphone size={13} className="text-violet-500" />;
  if (mode === "Card") return <CreditCard size={13} className="text-orange-500" />;
  return <Building2 size={13} className="text-sky-500" />;
};

const modeColor: Record<string, string> = {
  Cash: "bg-emerald-500/10 text-emerald-600",
  Check: "bg-blue-500/10 text-blue-600",
  UPI: "bg-violet-500/10 text-violet-600",
  NEFT: "bg-sky-500/10 text-sky-600",
  RTGS: "bg-cyan-500/10 text-cyan-600",
  Card: "bg-orange-500/10 text-orange-600",
};

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <ArrowDownCircle size={30} className="text-primary" />
      </div>
      <h3 className="font-heading font-semibold text-foreground text-base mb-1">No received payments yet</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        Record payments received from clients or customers.
      </p>
      <Button onClick={onAdd} size="sm">
        <Plus size={15} className="mr-1.5" />
        Add Received Payment
      </Button>
    </div>
  );
}

export default function ReceivedPaymentPage() {
  const [payments, setPayments] = useState<ReceivedPayment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  // Form state
  const [form, setForm] = useState({
    receivedFrom: "",
    projectName: "",
    mode: "NEFT" as ReceivedPayment["mode"],
    amount: "",
    bankName: "",
    transactionId: "",
    checkNumber: "",
    remarks: "",
  });
  const [date, setDate] = useState<Date | undefined>(new Date());

  useEffect(() => {
    const saved = localStorage.getItem("receivedPaymentData");
    if (saved) {
      setPayments(JSON.parse(saved));
    }
  }, []);

  const save = (updated: ReceivedPayment[]) => {
    setPayments(updated);
    localStorage.setItem("receivedPaymentData", JSON.stringify(updated));
  };

  const handleSubmit = () => {
    if (!form.receivedFrom.trim()) { toast.error("Received from is required"); return; }
    if (!form.projectName) { toast.error("Project is required"); return; }
    if (!date) { toast.error("Date is required"); return; }
    if (!form.amount || Number(form.amount) <= 0) { toast.error("Valid amount is required"); return; }

    const newPay: ReceivedPayment = {
      id: `RCP${String(payments.length + 1).padStart(4, "0")}`,
      receivedFrom: form.receivedFrom.trim(),
      projectName: form.projectName,
      docDate: date.toISOString(),
      mode: form.mode,
      amount: Number(form.amount),
      bankName: form.bankName || undefined,
      transactionId: form.transactionId || undefined,
      checkNumber: form.checkNumber || undefined,
      remarks: form.remarks || undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    save([newPay, ...payments]);
    toast.success(`${newPay.id} recorded successfully`);
    setForm({ receivedFrom: "", projectName: "", mode: "NEFT", amount: "", bankName: "", transactionId: "", checkNumber: "", remarks: "" });
    setDate(new Date());
    setIsOpen(false);
  };

  const deletePayment = (id: string) => {
    save(payments.filter((p) => p.id !== id));
    toast.success("Payment deleted");
  };

  const filtered = payments.filter((p) => {
    const matchSearch = p.receivedFrom.toLowerCase().includes(search.toLowerCase()) ||
      p.projectName.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase());
    const matchMode = filterMode === "All" || p.mode === filterMode;
    const matchStatus = filterStatus === "All" || p.status === filterStatus;
    return matchSearch && matchMode && matchStatus;
  });

  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);
  const cleared = payments.filter((p) => p.status === "cleared").length;
  const pending = payments.filter((p) => p.status === "pending").length;

  const stats = [
    { label: "Total Received", value: `₹${totalReceived.toLocaleString("en-IN")}`, icon: IndianRupee, color: "hsl(142, 71%, 45%)" },
    { label: "Total Entries", value: String(payments.length), icon: ArrowDownCircle, color: "hsl(var(--primary))" },
    { label: "Cleared", value: String(cleared), icon: CheckCircle2, color: "hsl(142, 71%, 45%)" },
    { label: "Pending", value: String(pending), icon: Clock, color: "hsl(38, 92%, 50%)" },
  ];

  return (
    <>
      <Breadcrumbs items={["Finance", "Received Payments"]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <ArrowDownCircle size={20} className="text-emerald-500" />
            Received Payments
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            All inbound payments received from clients &amp; customers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setIsOpen(true)}>
            <Plus size={15} className="mr-1" />
            Add Payment
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-card border border-border p-4 flex items-center gap-3"
            style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
          >
            <div className="p-2 rounded-lg shrink-0" style={{ background: `${s.color}20` }}>
              <s.icon size={18} style={{ color: s.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-heading truncate">{s.label}</p>
              <p className="text-base font-heading font-bold text-foreground truncate">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Search by party, project, ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs max-w-64"
        />
        <Select value={filterMode} onValueChange={setFilterMode}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Modes</SelectItem>
            {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground text-sm">All Received Payments</h2>
          <span className="text-xs text-muted-foreground">{filtered.length} entries</span>
        </div>

        {payments.length === 0 ? (
          <EmptyState onAdd={() => setIsOpen(true)} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">No results match your filters.</div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Doc No.", "Date", "Received From", "Project", "Mode", "Amount (₹)", "Bank / TxnID", "Status", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} className={`border-b border-border hover:bg-muted/50 transition-colors ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                      <td className="px-4 py-3 text-primary font-heading text-xs font-medium whitespace-nowrap">{p.id}</td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{format(new Date(p.docDate), "dd/MM/yyyy")}</td>
                      <td className="px-4 py-3 font-medium text-foreground max-w-[140px] truncate">{p.receivedFrom}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[120px] truncate">{p.projectName}</td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading w-fit ${modeColor[p.mode]}`}>
                          {modeIcon(p.mode)}{p.mode}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-heading font-semibold text-emerald-600 whitespace-nowrap">
                        +₹{p.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[140px] truncate">
                        {p.bankName ? <span>{p.bankName}</span> : null}
                        {p.transactionId ? <span className="block font-mono">{p.transactionId}</span> : null}
                        {p.checkNumber ? <span className="block">Chq: {p.checkNumber}</span> : null}
                        {!p.bankName && !p.transactionId && !p.checkNumber ? "—" : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${p.status === "cleared" ? "bg-green-500/15 text-green-600" : "bg-yellow-500/15 text-yellow-600"}`}>
                          {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => deletePayment(p.id)} className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="sm:hidden divide-y divide-border">
              {filtered.map((p) => (
                <div key={p.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-primary font-heading font-medium">{p.id}</p>
                      <p className="text-sm font-semibold text-foreground">{p.receivedFrom}</p>
                      <p className="text-xs text-muted-foreground">{p.projectName} · {format(new Date(p.docDate), "dd/MM/yyyy")}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-heading font-bold text-emerald-600">+₹{p.amount.toLocaleString("en-IN")}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${p.status === "cleared" ? "bg-green-500/15 text-green-600" : "bg-yellow-500/15 text-yellow-600"}`}>
                        {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading w-fit ${modeColor[p.mode]}`}>
                      {modeIcon(p.mode)}{p.mode}
                    </span>
                    <button onClick={() => deletePayment(p.id)} className="p-1.5 text-muted-foreground/50 hover:text-destructive">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownCircle size={18} className="text-emerald-500" />
              Record Received Payment
            </DialogTitle>
            <DialogDescription>
              Log an inbound payment received from a client or customer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Received From */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Received From *</label>
              <Input placeholder="Client / Customer name" value={form.receivedFrom} onChange={(e) => setForm((f) => ({ ...f, receivedFrom: e.target.value }))} />
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Project *</label>
              <Select value={form.projectName} onValueChange={(v) => setForm((f) => ({ ...f, projectName: v }))}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>{MOCK_PROJECTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Date + Mode row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Date *</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-between font-normal", !date && "text-muted-foreground")}>
                      {date ? format(date, "dd/MM/yyyy") : "Pick date"}
                      <CalendarIcon size={14} className="opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent mode="single" selected={date} onSelect={setDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Mode *</label>
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as ReceivedPayment["mode"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Amount (₹) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">₹</span>
                <Input className="pl-7 font-mono" placeholder="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") }))} />
              </div>
            </div>

            {/* Bank + Txn ID */}
            {(form.mode !== "Cash") && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Bank Name</label>
                  <Input placeholder="e.g. HDFC Bank" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{form.mode === "Check" ? "Check No." : "Transaction ID"}</label>
                  <Input placeholder={form.mode === "Check" ? "CHK001" : "TXN/REF ID"} value={form.mode === "Check" ? form.checkNumber : form.transactionId} onChange={(e) => setForm((f) => form.mode === "Check" ? { ...f, checkNumber: e.target.value } : { ...f, transactionId: e.target.value })} />
                </div>
              </div>
            )}

            {/* Remarks */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Remarks</label>
              <Input placeholder="Optional note" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="gap-1.5">
              <ArrowDownCircle size={14} />
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
