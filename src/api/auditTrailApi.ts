import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface AuditTrailEntry {
  Id: number;
  EntityType: string;
  EntityId: number;
  EntityName: string | null;
  Action: "CREATE" | "UPDATE" | "DELETE";
  UserId: number;
  UserName: string | null;
  Details: string | null;
  CreatedAt: string;
}

export const getAuditTrail = async (entityType: string): Promise<AuditTrailEntry[]> => {
  const res = await fetchWithAuth(`/api/audit-trail?entityType=${encodeURIComponent(entityType)}`);
  if (!res.ok) throw new Error("Couldn't load the audit trail. Please try again.");
  return res.json().catch(() => []);
};
