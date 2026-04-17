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
import { getBRS, matchBRS, unmatchBRS, autoMatchBRS } from "@/api/brsApi";

type Payment = {
  id: number;
  projectName: string;
  amount: number;
  docDate: Date;
  tagDOC?: string;
  bankName?: string;
  transactionId?: string;
  status: "pending" | "reconciled";
  createdAt: Date;
};

export default function Brs() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("All");
  const [selectedBank, setSelectedBank] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [loading, setLoading] = useState(false);

  // ================= FETCH =================
  const fetchBRS = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBRS({});
      const backendData = res.data.data || [];

      const mapped: Payment[] = backendData.map((item: any) => ({
        id: item.BRSID,
        projectName: `Bank ${item.BankID}`,
        amount: Number(item.Amount),
        docDate: new Date(item.BankDate),
        tagDOC: `Txn ${item.TransactionID || ""}`,
        bankName: `Bank ${item.BankID}`,
        transactionId: item.TransactionID?.toString(),
        status: item.IsMatched ? "reconciled" : "pending",
        createdAt: new Date(item.CreatedAt),
      }));

      setPayments(mapped);
    } catch (err) {
      console.error("BRS fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBRS();
  }, [fetchBRS]);

  // ================= FILTER =================
  const filteredPayments = payments.filter(
    (p) =>
      (selectedCompany === "All" || p.projectName === selectedCompany) &&
      (selectedBank === "All" || (p.bankName || "") === selectedBank) &&
      (filterStatus === "All" ||
        p.status === (filterStatus === "checked" ? "reconciled" : "pending"))
  );

  // ================= AUTO MATCH =================
  const autoMatch = useCallback(async () => {
    try {
      setLoading(true);
      await autoMatchBRS();
      alert("Auto reconciliation completed!");
      fetchBRS();
    } catch (err) {
      console.error("Auto match failed", err);
    } finally {
      setLoading(false);
    }
  }, [fetchBRS]);

  // ================= TOGGLE =================
  const toggleReconciled = useCallback(
    async (id: number, status: "pending" | "reconciled") => {
      try {
        if (status === "reconciled") {
          await unmatchBRS(id);
        } else {
          await matchBRS(id);
        }
        fetchBRS();
      } catch (err) {
        console.error("Toggle error", err);
      }
    },
    [fetchBRS]
  );

  // ================= STATS =================
  const uniqueCompanies = Array.from(
    new Set(payments.map((p) => p.projectName))
  ).sort();

  const uniqueBanks = Array.from(
    new Set(payments.map((p) => p.bankName).filter(Boolean) as string[])
  ).sort();

  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const reconciledCount = filteredPayments.filter(
    (p) => p.status === "reconciled"
  ).length;
  const pendingCount = filteredPayments.filter(
    (p) => p.status === "pending"
  ).length;

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
      color: "green",
    },
    {
      label: "Pending",
      value: String(pendingCount),
      icon: ListChecks,
      color: "red",
    },
    {
      label: "Banks",
      value: String(uniqueBanks.length),
      icon: Landmark,
      color: "blue",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["BRS"]} />
      <h1 className="text-xl font-bold mb-4">
        Bank Reconciliation Statement
      </h1>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {summaryStats.map((s) => (
          <div key={s.label} className="border p-4 rounded">
            <p className="text-xs">{s.label}</p>
            <p className="text-lg font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3 items-end">
        <Select value={selectedCompany} onValueChange={setSelectedCompany}> 
          <SelectTrigger>
            <SelectValue placeholder="Company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            {uniqueCompanies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedBank} onValueChange={setSelectedBank}>
          <SelectTrigger>
            <SelectValue placeholder="Bank" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            {uniqueBanks.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={autoMatch} disabled={loading} className="ml-auto">
          <ListChecks className="w-4 h-4 mr-1" />
          Auto Reconcile
        </Button>
      </div>

      {/* Table */}
      <table className="w-full border">
        <thead>
          <tr>
            <th>✓</th>
            <th>Company</th>
            <th>Amount</th>
            <th>Date</th>
            <th>Txn</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {filteredPayments.map((p) => (
            <tr key={p.id}>
              <td>
                <Checkbox
                  checked={p.status === "reconciled"}
                  onCheckedChange={() =>
                    toggleReconciled(p.id, p.status)
                  }
                />
              </td>
              <td>{p.projectName}</td>
              <td>₹{p.amount}</td>
              <td>{format(p.docDate, "dd/MM/yyyy")}</td>
              <td>{p.transactionId}</td>
              <td>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}