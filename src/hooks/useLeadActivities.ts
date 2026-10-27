import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Single shared source for "log an interaction against a lead" — was
// reimplemented independently in SaLeadActivities.tsx and SaFollowups.tsx
// (same /api/sa/lead-activities endpoints, near-identical field sets, two
// separate fetch-and-toast implementations). NOT used by
// SaInquiryDashboard.tsx's "Log Call" — that's backed by a genuinely
// different endpoint (/api/sa/inquiry) and schema (Outcome/Classification/
// DurationSeconds/Remarks, with a Classification side-effect on the lead),
// not a UI duplicate of this one despite looking similar.
const ACTIVITIES_API = "/api/sa/lead-activities";

export interface LeadActivityPayload {
  ActivityType: string;
  Direction?: string | null;
  Outcome?: string | null;
  Summary: string;
  NextFollowupDate?: string | null;
}

export function useLeadActivityHistory(leadId: number | null | undefined) {
  return useQuery({
    queryKey: ["sa-lead-activity-history", leadId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${ACTIVITIES_API}/lead/${leadId}`);
      if (!res.ok) return [];
      return res.json().catch(() => []);
    },
    enabled: !!leadId,
  });
}

export function useLogLeadActivity() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const logActivity = async (leadId: number, payload: LeadActivityPayload): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${ACTIVITIES_API}/lead/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to log activity");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sa-lead-activity-history", leadId] }),
        qc.invalidateQueries({ queryKey: ["sa-lead-activities"] }),
        qc.invalidateQueries({ queryKey: ["sa-pending-followups"] }),
        qc.invalidateQueries({ queryKey: ["sa-untouched-followup-leads"] }),
        qc.invalidateQueries({ queryKey: ["sa-leads"] }),
      ]);
      return true;
    } finally {
      setSaving(false);
    }
  };

  return { logActivity, saving };
}
