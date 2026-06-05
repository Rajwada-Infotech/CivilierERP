// src/api/followupCommunicatorApi.ts
import axios from "axios";

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
  send: async (payload: SendPayload): Promise<{ success: boolean; message: string }> => {
    const res = await axios.post(`${BASE}/send`, payload);
    return res.data;
  },

  /** System trigger — sends welcome messages across all configured channels */
  trigger: async (payload: TriggerPayload): Promise<{ success: boolean; results: TriggerResult[] }> => {
    const res = await axios.post(`${BASE}/trigger`, payload);
    return res.data;
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
    const res = await axios.get(`${BASE}/logs`, { params });
    return res.data;
  },

  /** Single log entry */
  getLog: async (id: number): Promise<CommunicatorLog> => {
    const res = await axios.get(`${BASE}/logs/${id}`);
    return res.data;
  },
};