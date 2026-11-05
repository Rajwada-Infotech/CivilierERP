import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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

// Everything that shows a lead's activity, refreshed after a new entry.
const refreshLeadActivity = (qc: QueryClient, leadId: number) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ["sa-lead-activity-history", leadId] }),
    qc.invalidateQueries({ queryKey: ["sa-lead-activities"] }),
    qc.invalidateQueries({ queryKey: ["sa-pending-followups"] }),
    qc.invalidateQueries({ queryKey: ["sa-untouched-followup-leads"] }),
    qc.invalidateQueries({ queryKey: ["sa-leads"] }),
  ]);

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
      await refreshLeadActivity(qc, leadId);
      return true;
    } finally {
      setSaving(false);
    }
  };

  return { logActivity, saving };
}

export type LeadMessageChannel = "SMS" | "WhatsApp" | "Email";

export interface LeadMessagingChannel {
  type: LeadMessageChannel;
  /** Set up and switched on in Admin → Integrations — it would send right now. */
  ready: boolean;
  saved: boolean;
  active: boolean;
}

/** Which of SMS / WhatsApp / Email can send to a lead right now (Admin → Integrations). */
export function useSaMessagingStatus() {
  return useQuery({
    queryKey: ["sa-messaging-status"],
    queryFn: async (): Promise<LeadMessagingChannel[]> => {
      const res = await fetchWithAuth(`${ACTIVITIES_API}/messaging-status`);
      if (!res.ok) throw new Error("Could not read the messaging channels");
      return (await res.json().catch(() => ({}))).channels ?? [];
    },
    staleTime: 60_000,
  });
}

/** Sends a message to the lead's customer through the admin provider; the server records it as an activity. */
export function useSendLeadMessage() {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);

  const sendMessage = async (leadId: number, payload: { channel: LeadMessageChannel; subject?: string; text: string }) => {
    setSending(true);
    try {
      const res = await fetchWithAuth(`${ACTIVITIES_API}/lead/${leadId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Message not sent");
      await refreshLeadActivity(qc, leadId);
    } finally {
      setSending(false);
    }
  };

  return { sendMessage, sending };
}
