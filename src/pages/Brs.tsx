import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDown, CheckCircle } from "lucide-react";
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

export default function Brs() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("All");
  const [selectedProject, setSelectedProject] = useState("All");
  const [selectedBank, setSelectedBank] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  useEffect(() => {
    // Add sample data if no payments
    const saved = localStorage.getItem('paymentData');
    if (!saved) {
      const sampleData: Payment[] = [
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
          status: "pending" as const,
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
          status: "reconciled" as const,
          createdAt: new Date(),
        },
        {
          id: "PAY0003",
          projectName: "Commercial Tower",
          amount: 50000,
          docDate: new Date("2024-09-10"),
          mode: "Cash",
          tagDOC: "Supplier DEF Pvt Ltd",
          status: "pending" as const,
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
          status: "pending" as const,
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
          status: "reconciled" as const,
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
          status: "pending" as const,
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
          status: "reconciled" as const,
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
          status: "pending" as const,
          createdAt: new Date(),
        },
        {
          id: "PAY0009",
          projectName: "Gamma Residential",
          amount: 200000,
          docDate: new Date("2024-09-25"),
          mode: "Cash",
          tagDOC: "Material Supplier OPQ Steel",
          status: "pending" as const,
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
          status: "reconciled" as const,
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
          status: "pending" as const,
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
          status: "reconciled" as const,
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
          status: "pending" as const,
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
          status: "reconciled" as const,
          createdAt: new Date(),
        },
        {
          id: "PAY0015",
          projectName: "Commercial Tower",
          amount: 42000,
          docDate: new Date("2024-10-12"),
          mode: "Cash",
          tagDOC: "Local Vendor DEF Supplies",
          status: "pending" as const,
          createdAt: new Date(),
        }
      ];
      localStorage.setItem('paymentData', JSON.stringify(sampleData));
      setPayments(sampleData);
    } else {
      const parsed: Payment[] = JSON.parse(saved);
      const fixedParsed = parsed.map((p: any) => ({
        ...p,
        status: p.status === 'reconciled' ? 'reconciled' : 'pending',
        docDate: new Date(p.docDate),
      }));
      setPayments(fixedParsed);
    }
  }, []);

  useEffect(() => {
    if (payments.length > 0) {
      localStorage.setItem('paymentData', JSON.stringify(payments));
    }
  }, [payments]);

  const filteredPayments = payments.filter(p => 
    (selectedCompany === "All" || p.projectName === selectedCompany) &&
    (selectedProject === "All" || p.projectName === selectedProject) &&
    (selectedBank === "All" || (p.bankName || "") === selectedBank) &&
    (filterStatus === "All" || p.status === (filterStatus === "checked" ? "reconciled" : "pending"))
  );

  const toggleReconciled = useCallback((id: string) => {
    setPayments(prev => prev.map(p =>
      p.id === id 
        ? { ...p, status: p.status === 'reconciled' ? 'pending' as const : 'reconciled' as const }
        : p
    ));
  }, []);

  const exportToExcel = () => {
    const csvRows = [
        ['Company', 'Amount', 'Date', 'Transaction ID', 'Customer/Supplier', 'Status', 'Bank'],
      ...filteredPayments.map(p => [
        p.projectName,
        p.amount.toLocaleString('en-IN'),
        format(p.docDate, 'dd/MM/yyyy'),
        p.transactionId || p.checkNumber || p.id,
        p.tagDOC?.slice(0, 30) || "N/A",
        p.status === 'reconciled' ? "CHECKED" : "UNCHECKED",
        p.bankName || "N/A",
      ])
    ];

    const csvContent = csvRows.map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')).join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `BRS_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const uniqueCompanies = Array.from(new Set(payments.map(p => p.projectName))).sort();
  const uniqueProjects = Array.from(new Set(payments.map(p => p.projectName))).sort();
  const uniqueBanks = Array.from(new Set(payments.map(p => p.bankName).filter(Boolean) as string[])).sort();

  return (
    <>
      <Breadcrumbs items={["BRS"]} />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bank Reconciliation Statement</h1>
            <p className="text-muted-foreground mt-2">Reconcile payments with bank statements</p>
          </div>
        </div>

        {/* Header */}
        <Card>
          <CardHeader>
            <CardTitle>BRS Header</CardTitle>
            <CardDescription>Company, Bank, Export and Check/Uncheck options</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-4 flex-1">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">Company</label>
                  <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All</SelectItem>
                      {uniqueCompanies.map(company => (
                        <SelectItem key={company} value={company}>{company}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">Project</label>
                  <Select value={selectedProject} onValueChange={setSelectedProject}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Projects" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All</SelectItem>
                      {uniqueProjects.map(project => (
                        <SelectItem key={project} value={project}>{project}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">Bank</label>
                  <Select value={selectedBank} onValueChange={setSelectedBank}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Banks" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All</SelectItem>
                      {uniqueBanks.map(bank => (
                        <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Status Filter
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
                <Button onClick={exportToExcel} disabled={filteredPayments.length === 0} className="gap-2">
                  <FileDown className="h-4 w-4" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transactions Table */}
        <Card>
          <CardHeader>
            <CardTitle>Transaction Area</CardTitle>
            <p className="text-sm text-muted-foreground">
              {filteredPayments.length} of {payments.length} transactions shown
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {filteredPayments.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No matching transactions. Adjust filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">✓</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Customer/Supplier</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <Checkbox
                            checked={payment.status === 'reconciled'}
                            onCheckedChange={() => toggleReconciled(payment.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{payment.projectName}</TableCell>
                        <TableCell className="text-right font-mono">
                          ₹{payment.amount.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {format(payment.docDate, 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {payment.transactionId || payment.checkNumber || payment.id}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          {payment.tagDOC?.slice(0, 30) || "N/A"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={payment.status === 'reconciled' ? "default" : "secondary"} className="text-xs">
                            {payment.status === 'reconciled' ? "CHECKED" : "UNCHECKED"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
