// RN port of the web Finance Dashboard's inline fetch (src/pages/finance/FinanceDashboard.tsx
// calls fetchWithAuth("/api/finance-dashboard") directly in a useQuery — there's no
// financeDashboardApi.ts on web to copy). Types here match the REAL backend response
// (backend/routes/financeDashboard.js), not the web frontend's own stale `cheques` type
// ({totalCount,pendingCount,draftCount,clearedCount}) — the backend actually returns
// {totalCount,activeCount,inactiveCount}, and the web UI's reads of pendingCount/
// draftCount/clearedCount silently resolve to undefined because of that mismatch.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface RecentPaymentMade {
  PPaymentID: number;
  PPaymentName: string;
  PMode: string;
  PAmount: number;
  PDate: string;
  PBankName?: string;
  PDocType?: string;
  PProject?: string;
  PCreatedAt?: string;
}

export interface RecentPaymentReceived {
  RPPaymentID: number;
  RPReceivedFrom: string;
  RPMode: string;
  RPAmount: number;
  RPDocDate: string;
  RPBankName?: string;
  RPStatus: string;
  RPCreatedAt?: string;
}

export interface FinanceDashboardData {
  paymentsMade: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
    thisMonthAmount: number;
  };
  receivedPayments: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
    approvedCount: number;
    draftCount: number;
  };
  cheques: { totalCount: number; activeCount: number; inactiveCount: number };
  cards: { totalCount: number; activeCount: number; inactiveCount: number };
  banks: { totalCount: number; activeCount: number };
  purchaseOrders: { totalCount: number; openCount: number; totalValue: number; openValue: number };
  parties: { supplierCount: number; activeSupplierCount: number; customerCount: number; activeGLCount: number };
  recentPaymentsMade: RecentPaymentMade[];
  recentPaymentsReceived: RecentPaymentReceived[];
}

export const EMPTY_FINANCE_DASHBOARD: FinanceDashboardData = {
  paymentsMade: { totalCount: 0, todayCount: 0, totalAmount: 0, todayAmount: 0, thisMonthAmount: 0 },
  receivedPayments: { totalCount: 0, todayCount: 0, totalAmount: 0, todayAmount: 0, approvedCount: 0, draftCount: 0 },
  cheques: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  cards: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  banks: { totalCount: 0, activeCount: 0 },
  purchaseOrders: { totalCount: 0, openCount: 0, totalValue: 0, openValue: 0 },
  parties: { supplierCount: 0, activeSupplierCount: 0, customerCount: 0, activeGLCount: 0 },
  recentPaymentsMade: [],
  recentPaymentsReceived: [],
};

export async function fetchFinanceDashboard(): Promise<FinanceDashboardData> {
  const res = await fetchWithAuth("/api/finance-dashboard");
  if (!res.ok) throw new Error("Failed to fetch finance dashboard");
  const raw = await res.json().catch(() => ({}));
  return { ...EMPTY_FINANCE_DASHBOARD, ...raw };
}
