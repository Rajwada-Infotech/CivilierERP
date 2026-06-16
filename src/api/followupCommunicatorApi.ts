// src/api/followupCommunicatorApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/followup-communicator";

export type Channel = "email" | "sms" | "whatsapp";
export type SendStatus = "Sent" | "Failed";

export interface SendPayload {
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  applicantId?: number;
  bookingId?: number;
  sentBy?: string;
}

export interface TriggerPayload {
  triggerType: "booking" | "welcomecall";
  applicantId: number;
  bookingId?: number;
  applicantName: string;
  email?: string;
  phone?: string;
  projectName?: string;
  unitNo?: string;
  bookingDate?: string;
  contactName?: string;
  contactPhone?: string;
}

export interface TriggerResult {
  channel: Channel;
  status: "sent" | "failed";
  error?: string;
}

export interface CommunicatorLog {
  Id: number;
  ApplicantId: number | null;
  BookingId: number | null;
  Channel: Channel;
  Recipient: string;
  Subject: string | null;
  Body: string;
  Status: SendStatus;
  ErrorMessage: string | null;
  SentBy: string | null;
  SentAt: string;
}

export interface LogsResponse {
  data: CommunicatorLog[];
  page: number;
  limit: number;
}

export const followupCommunicatorApi = {
  /** Ad-hoc send from UI */
  send: async (
    payload: SendPayload,
  ): Promise<{ success: boolean; message: string }> => {
    const res = await fetchWithAuth(`${BASE}/send`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Send failed");
    }
    return res.json();
  },

  /** System trigger — sends welcome messages across all configured channels */
  trigger: async (
    payload: TriggerPayload,
  ): Promise<{ success: boolean; results: TriggerResult[] }> => {
    const res = await fetchWithAuth(`${BASE}/trigger`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Trigger failed");
    }
    return res.json();
  },

  /** Fetch sent log */
  getLogs: async (params: {
    applicantId?: number;
    bookingId?: number;
    channel?: Channel;
    status?: SendStatus;
    page?: number;
    limit?: number;
  }): Promise<LogsResponse> => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    const res = await fetchWithAuth(`${BASE}/logs${qs ? "?" + qs : ""}`);
    if (!res.ok) throw new Error("Failed to fetch communicator logs");
    return res.json();
  },

  /** Single log entry */
  getLog: async (id: number): Promise<CommunicatorLog> => {
    const res = await fetchWithAuth(`${BASE}/logs/${id}`);
    if (!res.ok) throw new Error("Failed to fetch log entry");
    return res.json();
  },
};