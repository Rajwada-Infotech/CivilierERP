import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "/api/bank-master";
const ENTERPRISE_OPTIONS_URL = "/api/enterprises/options";

const getBanks = () => fetchWithAuth(BASE).then((r) => r.json());
const getEnterpriseOptions = () =>
  fetchWithAuth(ENTERPRISE_OPTIONS_URL).then((r) => r.json());
const addBank = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const updateBank = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const deleteBank = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => r.json());

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbEnterprise {
  id: number;
  label: string;
}

interface DbBank {
  BId: number;
  BName: string | null;
  BBranch: string | null;
  BAccountNumber: string | null;
  BIfscCode: string | null;
  BAccountType: string | null;
  BBankType: string | null;
  BAccountHolderName: string | null;
  BOpeningBalance: number | null;
  BAddress: string | null;
  BStatus: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  BName: (r.bankName as string) || null,
  BBranch: (r.branch as string) || null,
  BAccountNumber: (r.accountNo as string) || null,
  BIfscCode: (r.ifsc as string) || null,
  BAccountType: (r.accountType as string) || null,
  BBankType: (r.bankType as string) || null,
  BAccountHolderName: (r.holderName as string) || null,
  BOpeningBalance: r.openingBalance ? Number(r.openingBalance) : null,
  BAddress: (r.address as string) || null,
  BStatus: r.status !== false,
  CompanyName: (r.companyName as string) || "",
});

// ─── Component ────────────────────────────────────────────────────────────────
const BankMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["banks"],
    queryFn: getBanks,
  });

  const { data: enterpriseData, isLoading: loadingEnterprises } = useQuery({
    queryKey: ["enterprise-options"],
    queryFn: getEnterpriseOptions,
  });

  const dbItems: DbBank[] = Array.isArray(dbData) ? dbData : [];
  const enterprises: DbEnterprise[] = Array.isArray(enterpriseData)
    ? enterpriseData
    : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.BId),
    companyName: (item as any).CompanyName || "",
    bankName: item.BName || "",
    branch: item.BBranch || "",
    accountNo: item.BAccountNumber || "",
    ifsc: item.BIfscCode || "",
    accountType: item.BAccountType || "",
    bankType: item.BBankType || "",
    holderName: item.BAccountHolderName || "",
    openingBalance: item.BOpeningBalance ?? "",
    address: item.BAddress || "",
    status: item.BStatus,
  }));

const handleDataEvent = async (event: DataChangeEvent) => {
  // ── IFSC Validation (RBI Format: 4 letters + 0 + 6 alphanumeric) ──────────
  if (event.action === "add" || event.action === "update") {
    const ifsc = ((event.record.ifsc as string) || "").trim().toUpperCase();
    const isValidIFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
    if (!isValidIFSC) {
      toast.error(
        `Invalid IFSC Code "${ifsc || "empty"}". Format must be like SBIN0001234 (11 characters).`
      );
      return;
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

    if (event.action === "add") {
      try {
        await addBank(toPayload(event.record));
        toast.success("Bank saved!");
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateBank(event.id, toPayload(event.record));
        toast.success("Bank updated!");
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteBank(event.id);
        toast.success("Bank deleted!");
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  > = {
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        {value ? "Active" : "Inactive"}
      </span>
    ),
    bankType: (value) => {
      const map: Record<string, string> = {
        Nationalized: "bg-blue-500/10 border-blue-500/20 text-blue-600",
        Private: "bg-violet-500/10 border-violet-500/20 text-violet-600",
        "Co-operative": "bg-amber-500/10 border-amber-500/20 text-amber-600",
        Foreign: "bg-cyan-500/10 border-cyan-500/20 text-cyan-600",
        "Regional Rural": "bg-green-500/10 border-green-500/20 text-green-600",
      };
      const cls =
        map[value as string] ?? "bg-muted border-border text-muted-foreground";
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${cls}`}
        >
          {(value as string) || "—"}
        </span>
      );
    },
    openingBalance: (value) => (
      <span className="font-mono text-sm">
        ₹{Number(value || 0).toLocaleString("en-IN")}
      </span>
    ),
  };

  if (isLoading || loadingEnterprises)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load banks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Bank Master
      </h1>

      <MasterPage
        title="Bank"
        fields={[
          {
            name: "companyName",
            label: "Company Name",
            type: "select",
            required: true,
            options: enterprises.map((e) => e.label),
          },
          {
            name: "bankName",
            label: "Bank Name",
            type: "text",
            required: true,
          },
          { name: "branch", label: "Branch Name", type: "text" },
          {
            name: "accountNo",
            label: "Account Number",
            type: "text",
            required: true,
          },
          {
            name: "ifsc",
            label: "IFSC Code",
            type: "text",
            uppercase: true,
            required: true,
          },
          {
            name: "accountType",
            label: "Account Type",
            type: "select",
            options: ["Current", "Savings", "Overdraft (OD)", "Cash Credit"],
          },
          {
            name: "bankType",
            label: "Bank Type",
            type: "select",
            options: [
              "Nationalized",
              "Private",
              "Co-operative",
              "Foreign",
              "Regional Rural",
            ],
          },
          { name: "holderName", label: "Account Holder Name", type: "text" },
          {
            name: "openingBalance",
            label: "Opening Balance (₹)",
            type: "number",
          },
          {
            name: "address",
            label: "Address",
            type: "textarea",
            fullWidth: true,
          },
          {
            name: "status",
            label: "Status",
            type: "toggle",
            defaultValue: true,
          },
        ]}
        columns={[
          { key: "companyName", label: "Company", hideOnMobile: true },
          { key: "bankName", label: "Bank Name" },
          { key: "branch", label: "Branch", hideOnMobile: true },
          { key: "accountNo", label: "Account No." },
          { key: "ifsc", label: "IFSC", hideOnMobile: true },
          { key: "accountType", label: "Account Type", hideOnMobile: true },
          { key: "bankType", label: "Bank Type", hideOnMobile: true },
          { key: "openingBalance", label: "Opening Bal.", hideOnMobile: true },
          { key: "status", label: "Status" },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default BankMaster;
