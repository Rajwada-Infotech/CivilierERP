// Visitor approval. Guards and security admins use the staff routes (/api/security, backend/routes/securityIntercom.js);
// residents use the customer-portal routes (/api/security-portal, backend/routes/securityPortal.js).
import { fetchWithAuth } from "@/services/fetchWithAuth";
import type { VisitorRow } from "./securityDashboardApi";

export interface VisitorDetail extends VisitorRow {
  hasPhoto: boolean;
  escalatedAt: string | null;
  noResponseBy: "TIMEOUT" | "GUARD" | null;
  /** Staff only. */
  visitorPhone?: string | null;
  escalateAfterS?: number;
  expireAfterS?: number;
  /** Residents only: every decision on it, the settling one marked. */
  decisions?: { decision: "APPROVE" | "DENY"; settled: boolean; at: string; name: string | null }[];
  /** What the gate does when nobody answers (Security Gates): HOLD, ALLOW or CALL_OFFICE. */
  noResponsePolicy?: "HOLD" | "ALLOW" | "CALL_OFFICE";
  /** Let in on a guest pass. */
  passId?: number | null;
  /** Residents only, after deciding: false when someone else had already handled it. */
  settled?: boolean;
}

export interface NewVisitor {
  clientRequestId: string;
  block: string;
  flatNo: string;
  reason: string;
  visitorName?: string;
  visitorPhone?: string;
  vehicleNo?: string;
  photoBase64?: string | null;
  /** A resident's guest pass: by its 6-digit code or its id (the flat and visitor then come from the pass). */
  passCode?: string;
  passId?: number;
}

/** An error the server answered with (a refusal), as opposed to the network being down. */
export class VisitorRefused extends Error {}

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new VisitorRefused(body.error || `The request failed (${res.status}).`);
  return body as T;
}
const post = (path: string, body: unknown) => fetchWithAuth(path, { method: "POST", body: JSON.stringify(body) });

// ── Guard / security admin ──
export const searchFlats = async (q: string) =>
  read<{ gate: { name: string; projectName: string } | null; flats: { block: string; flatNo: string; residents: number }[] }>(
    await fetchWithAuth(`/api/security/flats?q=${encodeURIComponent(q)}`),
  );
/** Network failures throw a plain Error (the caller queues it); a refusal throws VisitorRefused. */
export const createVisitor = async (v: NewVisitor) => read<VisitorDetail>(await post("/api/security/visitors", v));
export const getVisitor = async (id: number) => read<VisitorDetail>(await fetchWithAuth(`/api/security/visitors/${id}`));
export const getVisitorContacts = async (id: number) =>
  read<{ customerId: number; name: string | null; mobile: string | null; isPrimary: boolean }[]>(await fetchWithAuth(`/api/security/visitors/${id}/contacts`));
export const markNoResponse = async (id: number) => read<VisitorDetail>(await post(`/api/security/visitors/${id}/no-response`, {}));
export const staffPhotoUrl = (id: number) => `/api/security/visitors/${id}/photo`;

// ── Resident ──
export const getPendingForMe = async () => read<VisitorRow[]>(await fetchWithAuth("/api/security-portal/visitors/pending"));
export const getVisitorForMe = async (id: number) => read<VisitorDetail>(await fetchWithAuth(`/api/security-portal/visitors/${id}`));
export const decideVisitor = async (id: number, decision: "approve" | "deny", device: { deviceId?: string; platform?: string }) =>
  read<VisitorDetail>(await post(`/api/security-portal/visitors/${id}/decision`, { decision, ...device }));
export const residentPhotoUrl = (id: number) => `/api/security-portal/visitors/${id}/photo`;
