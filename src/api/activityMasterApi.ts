import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/activity-master";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbActivity {
  id: number;
  activity_name: string;
  short_description: string | null;
  activity_type: number | null; // 0 = Group, 1 = Activity
  group_id: number | null; // INT in DB
  is_active: boolean;
  created_by: string | null; // nvarchar(300) — stores user email
  created_datetime: string | null;
  approved_by: string | null; // nvarchar(300) — stores user email
  approved_at: string | null;
  updated_by: string | null; // nvarchar(300) — stores user email
  updated_at: string | null;
  belongsTo: string | null; // nvarchar(200) — stores group_id as string, NULL for Groups
  hsn_code: string | null; // nvarchar(50) — linked HSN code, only for Activities
  cost_center_id: number | null; // FK → CostCenter.CostCenterId, only for Activities
  cost_center_name: string | null;
  gl_head_id: number | null; // FK → AccountHeadMaster.LHeadId, only for Activities
  gl_head_name: string | null;
}

export interface ActivityPayload {
  activity_name: string | null;
  short_description: string | null;
  activity_type: number; // 0 = Group, 1 = Activity
  group_id: number | null; // INT — NULL for Groups, group's id for Activities
  is_active: boolean;
  belongsTo: string | null; // nvarchar(200) — NULL for Groups, String(group_id) for Activities
  hsn_code: string | null; // nvarchar(50) — NULL for Groups, optional for Activities
  cost_center_id: number | null; // NULL for Groups, optional for Activities
  gl_head_id: number | null; // NULL for Groups, optional for Activities
}

export interface ApiResponse {
  message: string;
  id?: number;
}

// ─── Payload Builder ──────────────────────────────────────────────────────────

export const toPayload = (
  r: Record<string, unknown>,
  groupOptions: { value: string; label: string }[],
): ActivityPayload => {
  const isGroup = r.activityType === "Group";

  // groupId in the form holds the group's display label (from MasterPage select).
  // Resolve it back to the numeric id via groupOptions lookup.
  const matched = groupOptions.find((o) => o.label === r.groupId);
  const groupId = matched ? Number(matched.value) : null;

  return {
    activity_name: (r.activityName as string) || null,
    short_description: (r.shortDesc as string) || null,
    activity_type: isGroup ? 0 : 1,
    group_id: isGroup ? null : groupId, // NULL for Group, INT for Activity
    is_active: r.status !== false,
    belongsTo: isGroup ? null : groupId ? String(groupId) : null, // NULL for Group, "id" string for Activity
    hsn_code: isGroup ? null : (r.hsnCode as string) || null, // NULL for Group, optional for Activity
    // Custom-render selects (see ActivityMaster.tsx) hand back the raw id
    // as a string via onChange — parse it, don't cast, or "" is coerced to 0.
    cost_center_id: isGroup ? null : r.costCenterId ? Number(r.costCenterId) : null,
    gl_head_id: isGroup ? null : r.glHeadId ? Number(r.glHeadId) : null,
  };
};

// ─── API Functions ────────────────────────────────────────────────────────────

export const getActivities = async (): Promise<DbActivity[]> => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error(`Failed to fetch activities: ${res.statusText}`);
  return res.json().catch(() => ({}));
};

export const addActivity = async (
  data: ActivityPayload,
): Promise<ApiResponse> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to add activity: ${res.statusText}`);
  return res.json().catch(() => ({}));
};

export const updateActivity = async (
  id: string | number,
  data: ActivityPayload,
): Promise<ApiResponse> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update activity: ${res.statusText}`);
  return res.json().catch(() => ({}));
};

export const deleteActivity = async (
  id: string | number,
): Promise<ApiResponse> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete activity: ${res.statusText}`);
  return res.json().catch(() => ({}));
};
