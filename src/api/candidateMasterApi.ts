import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/candidate-master";

export interface CandidateRow {
  CandidateId: number;
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
  InterviewStatus: string | null;
  Remarks: string | null;
  IsActive: boolean;
  CreatedBy: string | null;
  CreatedAt: string;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

export interface CandidatePayload {
  CandidateCode: string;
  CandidateName: string;
  Contact?: string | null;
  Email?: string | null;
  Qualification?: string | null;
  Experience?: string | null;
  ExpectedSalary?: number | null;
  CurrentSalary?: number | null;
  NoticePeriod?: string | null;
  ResumeFileName?: string | null;
  ResumeBase64?: string | null;
  InterviewStatus?: string | null;
  Remarks?: string | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getCandidates = async (): Promise<CandidateRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addCandidate = async (payload: CandidatePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateCandidate = async (id: number, payload: CandidatePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export type InterviewResult = "Selected" | "Rejected" | "On Hold";

export const updateCandidateInterviewStatus = async (id: number, status: InterviewResult) => {
  const res = await fetchWithAuth(`${BASE}/${id}/interview-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ InterviewStatus: status }),
  });
  return handle<{ message: string }>(res);
};

export const deleteCandidate = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
