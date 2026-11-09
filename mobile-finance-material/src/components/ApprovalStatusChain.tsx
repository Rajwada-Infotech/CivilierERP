// RN port of src/components/ApprovalStatusChain.tsx (web) — a shared badge
// showing a record's approval-workflow state (Approved/Rejected/Pending at
// its current step). Fetches the same /api/approval-workflows/trail
// endpoint web does, so behavior stays identical across platforms. Not
// Vehicle-In/Out-specific — reusable by any future Material/Finance mobile
// screen backed by the approval-workflow system.
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator } from "react-native";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { sheet as S } from "@/theme/colors";
import { SheetMark } from "@/components/sheet/Sheet";

export type ApprovalTable =
  | "GoodsReceiptNotes" | "PurchaseOrders" | "WorkOrderHeader" | "ExpenseBooking"
  | "NewPayment" | "MaterialIssues" | "MaterialRequests" | "StockTransfers"
  | "BOQ" | "WorkDone" | "SaleOrders" | "VehicleInOut" | "Contract";

interface TrailStep {
  level: number;
  label: string;
  status: "Pending" | "Approved" | "Rejected";
  approverName: string | null;
}

interface TrailData {
  steps: TrailStep[];
}

async function fetchTrail(table: ApprovalTable, recordId: string | number): Promise<TrailData | null> {
  const res = await fetchWithAuth(`/api/approval-workflows/trail?module=${table}&id=${recordId}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export function ApprovalStatusChain({
  table, recordId, fallback = null,
}: { table: ApprovalTable; recordId: string | number | null | undefined; fallback?: React.ReactNode }) {
  const { data: trail, isLoading } = useQuery({
    queryKey: ["approval-trail", table, recordId],
    queryFn: () => fetchTrail(table, recordId!),
    enabled: recordId != null,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <ActivityIndicator size="small" color={S.graphite} />;
  }

  const steps = (trail?.steps ?? []).filter((s) => s.level > 0);
  if (steps.length === 0) return <>{fallback}</>;

  const fullyApproved = steps.every((s) => s.status === "Approved");
  const rejectedStep = steps.find((s) => s.status === "Rejected");
  const currentStep = steps.find((s) => s.status !== "Approved") ?? steps[steps.length - 1];

  const [tone, status, step] = fullyApproved
    ? (["done", "Approved", steps[steps.length - 1]] as const)
    : rejectedStep
      ? (["stopped", "Rejected", rejectedStep] as const)
      : (["waiting", "Pending", currentStep] as const);

  // The sheet's status mark: solid square approved, hatched waiting, red rejected.
  return <SheetMark text={`${step.label} · ${status}`} tone={tone} />;
}
