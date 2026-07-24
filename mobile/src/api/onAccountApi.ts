// RN port of src/api/onAccountApi.ts + src/api/onAccountAdjustment.ts (web).
// The preview math (previewOAAdjustment/excludeOriginatingInvoice) has zero
// DOM/React dependencies and is copied verbatim.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/on-account";

export interface OABalance {
  partyId: number | null;
  partyType: string | null;
  partyLabel: string | null;
  balance: number;
}

export async function getOABalance(partyId: number): Promise<OABalance> {
  const r = await fetchWithAuth(`${BASE}/balance/${partyId}`);
  if (!r.ok) return { partyId, partyType: null, partyLabel: null, balance: 0 };
  return r.json();
}

export interface OAInvoice {
  docNo: string;
  invoiceAmount: number;
  totalPaid: number;
  remaining: number;
  billStatus: string | null;
}

export async function getInvoicesForParty(partyId: number): Promise<OAInvoice[]> {
  const r = await fetchWithAuth(`${BASE}/invoices-for-party/${partyId}`);
  if (!r.ok) return [];
  return r.json();
}

export async function applyOAAdjustment(payload: {
  expenseRef: string;
  amount: number;
  partyId?: number;
  paymentDocNo?: string;
  paymentId?: number;
}): Promise<{ applied: number; remainingBalance: number }> {
  const r = await fetchWithAuth(`${BASE}/apply-adjustment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? "Failed to apply On Account adjustment");
  return body;
}

export interface OAPartySummary {
  PartyId: number;
  PartyName: string;
  PartyType: string;
  Balance: number;
}

export async function getOAPartySummary(): Promise<OAPartySummary[]> {
  const r = await fetchWithAuth(`${BASE}/party-summary`);
  if (!r.ok) return [];
  return r.json();
}

// One credit entry — an excess/on-account payment created against
// CreditEntry.InvoiceRef, still available to apply against a DIFFERENT
// outstanding invoice. Port of OnAccountAdjustment.tsx's local CreditEntry
// interface (never exported on web, so redeclared here).
export interface CreditEntry {
  OAId: number;
  PartyId: number;
  PartyName: string;
  PartyTypeCode: string;
  PaymentDate: string;
  PaymentDocNo: string;
  ExcessAmount: number;
  InvoiceRef: string | null;
  PaymentAmount: number | null;
  InvoiceAmount: number | null;
  InvoiceTotalPaid: number | null;
  InvoiceDocNo: string | null;
  AvailableBalance: number;
  Notes: string | null;
}

// Not wrapped in onAccountApi.ts on web either — OnAccountAdjustment.tsx
// calls it directly via fetchWithAuth.
export async function getAdjustableCredits(partyId?: number): Promise<CreditEntry[]> {
  const url = partyId != null ? `${BASE}/adjustable?partyId=${partyId}` : `${BASE}/adjustable`;
  const r = await fetchWithAuth(url);
  if (!r.ok) return [];
  return r.json();
}

// ─── Adjustment preview math (onAccountAdjustment.ts port) ─────────────────

export interface OAAdjustmentPreview {
  applyAmount: number;
  balanceAfter: number;
  invoiceRemainingAfter: number;
  isFullyCovered: boolean;
  isFullBalanceUsed: boolean;
}

export function previewOAAdjustment(
  balance: number,
  invoiceRemaining: number,
  requestedAmount?: number,
): OAAdjustmentPreview {
  const maxApplicable = Math.max(0, Math.min(balance, invoiceRemaining));
  const applyAmount = requestedAmount != null
    ? Math.max(0, Math.min(requestedAmount, maxApplicable))
    : maxApplicable;
  const balanceAfter = Math.max(0, balance - applyAmount);
  const invoiceRemainingAfter = Math.max(0, invoiceRemaining - applyAmount);
  return {
    applyAmount,
    balanceAfter,
    invoiceRemainingAfter,
    isFullyCovered: invoiceRemaining > 0 && invoiceRemainingAfter <= 0.005,
    isFullBalanceUsed: balance > 0 && balanceAfter <= 0.005,
  };
}

export function excludeOriginatingInvoice<T extends { docNo: string }>(
  invoices: T[],
  originatingDocNo: string | null | undefined,
): T[] {
  if (!originatingDocNo) return invoices;
  return invoices.filter((inv) => inv.docNo !== originatingDocNo);
}
