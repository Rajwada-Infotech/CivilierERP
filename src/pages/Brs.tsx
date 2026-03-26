import React, { useState, useEffect, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle, Landmark, IndianRupee, ListChecks } from "lucide-react";
import { format } from "date-fns";

type Payment = {
  id: string;
  projectName: string;
  amount: number;
  docDate: Date;
  mode: "Cash" | "Check" | "UPI" | "Card" | "NEFT" | "RTGS";
  tagDOC?: string;
  bankName?: string;
  transactionId?: string;
  checkNumber?: string;
  status: "pending" | "cleared" | "reconciled";
  createdAt: Date;
};

const SAMPLE_PAYMENTS: Payment[] = [
  {
    id: "PAY0001",
    projectName: "Project Alpha",
    amount: 15000,
    docDate: new Date("2024-09-01"),
    mode: "Check",
    tagDOC: "Supplier ABC Ltd",
    bankName: "HDFC Bank",
    transactionId: "HDFC TXN 001/2024",
    checkNumber: "CHK789",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0002",
    projectName: "Site Beta",
    amount: 25000,
    docDate: new Date("2024-09-05"),
    mode: "UPI",
    tagDOC: "Customer XYZ Corp",
    bankName: "ICICI Bank",
    transactionId: "ICICI UPI789/2024",
    status: "reconciled",
    createdAt: new Date(),
  },
  {
    id: "PAY0003",
    projectName: "Commercial Tower",
    amount: 50000,
    docDate: new Date("2024-09-10"),
    mode: "Cash",
    tagDOC: "Supplier DEF Pvt Ltd",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0004",
    projectName: "Project Alpha",
    amount: 30000,
    docDate: new Date("2024-09-12"),
    mode: "Card",
    tagDOC: "Customer PQR Enterprises",
    bankName: "SBI",
    transactionId: "SBI CARD123/2024",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0005",
    projectName: "Gamma Residential",
    amount: 75000,
    docDate: new Date("2024-09-15"),
    mode: "NEFT",
    tagDOC: "Contractor LMN Builders",
    bankName: "Axis Bank",
    transactionId: "AXIS NEFT456/2024",
    status: "reconciled",
    createdAt: new Date(),
  },
  {
    id: "PAY0006",
    projectName: "Site Beta",
    amount: 120000,
    docDate: new Date("2024-09-18"),
    mode: "RTGS",
    tagDOC: "Supplier GHI Infra",
    bankName: "HDFC Bank",
    transactionId: "HDFC RTGS789/2024",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0007",
    projectName: "Commercial Tower",
    amount: 45000,
    docDate: new Date("2024-09-20"),
    mode: "Check",
    tagDOC: "Customer JKL Retail",
    bankName: "ICICI Bank",
    transactionId: "ICICI CHK101/2024",
    checkNumber: "CHK101",
    status: "reconciled",
    createdAt: new Date(),
  },
  {
    id: "PAY0008",
    projectName: "Project Alpha",
    amount: 85000,
    docDate: new Date("2024-09-22"),
    mode: "UPI",
    tagDOC: "Freelancer MNO Designer",
    bankName: "SBI",
    transactionId: "SBI UPI234/2024",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0009",
    projectName: "Gamma Residential",
    amount: 200000,
    docDate: new Date("2024-09-25"),
    mode: "Cash",
    tagDOC: "Material Supplier OPQ Steel",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0010",
    projectName: "Site Beta",
    amount: 35000,
    docDate: new Date("2024-09-28"),
    mode: "Card",
    tagDOC: "Vendor RST Plumbing",
    bankName: "Axis Bank",
    transactionId: "AXIS CARD567/2024",
    status: "reconciled",
    createdAt: new Date(),
  },
  {
    id: "PAY0011",
    projectName: "Commercial Tower",
    amount: 95000,
    docDate: new Date("2024-10-02"),
    mode: "NEFT",
    tagDOC: "Consultant UVW Architects",
    bankName: "HDFC Bank",
    transactionId: "HDFC NEFT890/2024",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0012",
    projectName: "Project Alpha",
    amount: 65000,
    docDate: new Date("2024-10-05"),
    mode: "RTGS",
    tagDOC: "Client XYZ Developers",
    bankName: "ICICI Bank",
    transactionId: "ICICI RTGS123/2024",
    status: "reconciled",
    createdAt: new Date(),
  },
  {
    id: "PAY0013",
    projectName: "Gamma Residential",
    amount: 28000,
    docDate: new Date("2024-10-08"),
    mode: "Check",
    tagDOC: "Worker Salaries",
    bankName: "SBI",
    transactionId: "SBI CHK456/2024",
    checkNumber: "CHK456",
    status: "pending",
    createdAt: new Date(),
  },
  {
    id: "PAY0014",
    projectName: "Site Beta",
    amount: 175000,
    docDate: new Date("2024-10-10"),
    mode: "UPI",
    tagDOC: "Equipment Rental ABC Mach",
    bankName: "Axis Bank",
    transactionId: "AXIS UPI789/2024",
    status: "reconciled",
    createdAt: new Date(),
  },
  {
    id: "PAY0015",
    projectName: "Commercial Tower",
    amount: 42000,
    docDate: new Date("2024-10-12"),
    mode: "Cash",
    tagDOC: "Local Vendor DEF Supplies",
    status: "pending",
    createdAt: new Date(),
  },
];

export default function Brs() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("All");
  const [selectedBank, setSelectedBank] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  useEffect(() => {
    const saved = localStorage.getItem("brsData");
    if (!saved) {
      localStorage.setItem("brsData", JSON.stringify(SAMPLE_PAYMENTS));
      setPayments(SAMPLE_PAYMENTS);
    } else {
      const parsed: Payment[] = JSON.parse(saved);
      const fixed = parsed.map((p: any) => ({
        ...p,
        status: p.status === "reconciled" ? "reconciled" : "pending",
        docDate: new Date(p.docDate),
      }));
      setPayments(fixed);
    }
  }, []);

  useEffect(() => {
    if (payments.length > 0) {
      localStorage.setItem("brsData", JSON.stringify(payments));
    }
  }, [payments]);

  const filteredPayments = payments.filter(
    (p) =>
      (selectedCompany === "All" || p.projectName === selectedCompany) &&
      (selectedBank === "All" || (p.bankName || "") === selectedBank) &&
      (filterStatus === "All" ||
        p.status === (filterStatus === "checked" ? "reconciled" : "pending")),
  );

  const toggleReconciled = useCallback((id: string) => {
    setPayments((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status:
                p.status === "reconciled"
                  ? ("pending" as const)
                  : ("reconciled" as const),
            }
          : p,
      ),
    );
  }, []);

  const exportToExcel = () => {
    const csvRows = [
      ["Company", "Amount", "Date", "Transaction ID", "Customer/Supplier", "Status", "Bank"],
      ...filteredPayments.map((p) => [
        p.projectName,
        p.amount.toLocaleString("en-IN"),
        format(p.docDate, "dd/MM/yyyy"),
        p.transactionId || p.checkNumber || p.id,
        p.tagDOC?.slice(0, 30) || "N/A",
        p.status === "reconciled" ? "CHECKED" : "UNCHECKED",
        p.bankName || "N/A",
      ]),
    ];

    const csvContent = csvRows
      .map((row) =>
        row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `BRS_${format(new Date(), "yyyy-MM-dd_HH-mm-ss")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const uniqueCompanies = Array.from(new Set(payments.map((p) => p.projectName))).sort();
  const uniqueBanks = Array.from(
    new Set(payments.map((p) => p.bankName).filter(Boolean) as string[]),
  ).sort();

  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const reconciledCount = filteredPayments.filter((p) => p.status === "reconciled").length;
  const pendingCount = filteredPayments.filter((p) => p.status === "pending").length;

  const summaryStats = [
    {
      label: "Total Amount",
      value: `₹${totalAmount.toLocaleString("en-IN")}`,
      icon: IndianRupee,
      color: "hsl(var(--primary))",
    },
    {
      label: "Reconciled",
      value: String(reconciledCount),
      icon: CheckCircle,
      color: "hsl(142, 71%, 45%)",
    },
    {
      label: "Pending",
      value: String(pendingCount),
      icon: ListChecks,
      color: "hsl(0, 72%, 51%)",
    },
    {
      label: "Banks",
      value: String(uniqueBanks.length),
      icon: Landmark,
      color: "hsl(217, 91%, 60%)",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["BRS"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Bank Reconciliation Statement
      </h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {summaryStats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-card border border-border p-4 flex items-center gap-4"
            style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
          >
            <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
              <s.icon size={20} style={{ color: s.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
              <p className="text-base sm:text-lg font-heading font-bold text-foreground truncate">
                {s.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-card border border-border mb-6">
        <div className="p-4 border-b border-border">
          <h2 className="font-heading font-semibold text-foreground text-sm">Filters</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Filter by company, bank, and reconciliation status
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Company
              </label>
              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Companies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Companies</SelectItem>
                  {uniqueCompanies.map((company) => (
                    <SelectItem key={company} value={company}>
                      {company}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Bank
              </label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Banks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Banks</SelectItem>
                  {uniqueBanks.map((bank) => (
                    <SelectItem key={bank} value={bank}>
                      {bank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Status
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full h-9 justify-between font-normal">
                    <span>
                      {filterStatus === "All"
                        ? "All Statuses"
                        : filterStatus === "checked"
                          ? "Checked"
                          : "Unchecked"}
                    </span>
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuCheckboxItem
                    checked={filterStatus === "All"}
                    onCheckedChange={() => setFilterStatus("All")}
                  >
                    All
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filterStatus === "checked"}
                    onCheckedChange={() => setFilterStatus("checked")}
                  >
                    Checked
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filterStatus === "unchecked"}
                    onCheckedChange={() => setFilterStatus("unchecked")}
                  >
                    Unchecked
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-end">
              <button
                onClick={exportToExcel}
                disabled={filteredPayments.length === 0}
                title="Export to Excel"
                className="h-9 w-9 shrink-0 rounded-md flex items-center justify-center bg-[#1D6F42] hover:bg-[#185c37] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Page shape */}
                  <path d="M4 2h10l6 6v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.2" />
                  <path d="M14 2v6h6" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                  {/* Green X badge overlay */}
                  <rect x="10" y="11" width="12" height="10" rx="1.5" fill="#1D6F42" stroke="white" strokeWidth="0.8" />
                  <path d="M13 13.5l2.5 3m0-3L13 16.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M18 13.5l-1.5 1.5 1.5 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground text-sm">Transactions</h2>
          <span className="text-xs text-muted-foreground">
            {filteredPayments.length} of {payments.length} shown
          </span>
        </div>

        {filteredPayments.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No matching transactions. Adjust the filters above.
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["✓", "Company", "Amount (₹)", "Date", "Transaction ID", "Customer / Supplier", "Bank", "Status"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((payment, i) => (
                    <tr
                      key={payment.id}
                      className={`border-b border-border transition-colors hover:bg-muted/50 ${
                        i % 2 === 1 ? "bg-muted/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={payment.status === "reconciled"}
                          onCheckedChange={() => toggleReconciled(payment.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">
                        {payment.projectName}
                      </td>
                      <td className="px-4 py-3 text-foreground font-heading font-medium whitespace-nowrap">
                        ₹{payment.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {format(payment.docDate, "dd/MM/yyyy")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {payment.transactionId || payment.checkNumber || payment.id}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">
                        {payment.tagDOC?.slice(0, 30) || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {payment.bankName || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                            payment.status === "reconciled"
                              ? "bg-green-500/15 text-green-500"
                              : "bg-yellow-500/15 text-yellow-600"
                          }`}
                        >
                          {payment.status === "reconciled" ? "Checked" : "Unchecked"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="sm:hidden divide-y divide-border">
              {filteredPayments.map((payment) => (
                <div key={payment.id} className="p-4 flex items-start gap-3">
                  <Checkbox
                    checked={payment.status === "reconciled"}
                    onCheckedChange={() => toggleReconciled(payment.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {payment.projectName}
                      </p>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-heading ${
                          payment.status === "reconciled"
                            ? "bg-green-500/15 text-green-500"
                            : "bg-yellow-500/15 text-yellow-600"
                        }`}
                      >
                        {payment.status === "reconciled" ? "Checked" : "Unchecked"}
                      </span>
                    </div>
                    <p className="text-base font-heading font-bold text-foreground">
                      ₹{payment.amount.toLocaleString("en-IN")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(payment.docDate, "dd/MM/yyyy")}
                      {payment.bankName ? ` · ${payment.bankName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {payment.tagDOC || "N/A"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
