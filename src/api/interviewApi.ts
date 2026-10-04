import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/interviews";

export type InterviewStatus = "PENDING" | "SELECTED" | "REJECTED" | "HOLD";

export interface InterviewRow {
  InterviewId: number;
  DocNo: string;
  CandidateId: number;
  CompanyId: number | null;
  ProjectId: number | null;
  InterviewDate: string;
  Remarks: string | null;
  Status: InterviewStatus;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
  CandidateCode: string;
  CandidateName: string;
  Contact: string | null;
  Email: string | null;
  Qualification: string | null;
  Experience: string | null;
  ExpectedSalary: number | null;
  CurrentSalary: number | null;
  NoticePeriod: string | null;
  ResumeFileName: string | null;
  ResumeBase64: string | null;
  CandidateInterviewStatus: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
}

export interface InterviewPayload {
  CandidateId: number;
  CompanyId: number | null;
  ProjectId: number | null;
  InterviewDate: string;
  Remarks: string | null;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getInterviews = async (): Promise<InterviewRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addInterview = async (payload: InterviewPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; InterviewId: number }>(res);
};

export const updateInterview = async (id: number, payload: InterviewPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateInterviewStatus = async (id: number, status: InterviewStatus) => {
  const res = await fetchWithAuth(`${BASE}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Status: status }),
  });
  return handle<{ message: string }>(res);
};

export const deleteInterview = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
