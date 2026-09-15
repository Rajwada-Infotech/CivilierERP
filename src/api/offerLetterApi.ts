import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/offer-letter";

export interface OfferLetterRow {
  OfferId: number;
  DocNo: string;
  CandidateId: number;
  CompanyId: number | null;
  FinYearId: number | null;
  Salary: number | null;
  CandidateAddress: string | null;
  DateOfJoin: string | null;
  DocumentDate: string;
  Remarks: string | null;
  JoiningConfirmed: boolean;
  ActualDateOfJoining: string | null;
  JoiningRemarks: string | null;
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
  CandidateInterviewStatus: string | null;
  CompanyName: string | null;
  FinYearName: string | null;
}

export interface OfferLetterPayload {
  CandidateId: number;
  CompanyId: number | null;
  FinYearId: number | null;
  Salary: number | null;
  CandidateAddress: string | null;
  DateOfJoin: string | null;
  DocumentDate: string;
  Remarks: string | null;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getOfferLetters = async (): Promise<OfferLetterRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addOfferLetter = async (payload: OfferLetterPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; OfferId: number }>(res);
};

export const updateOfferLetter = async (id: number, payload: OfferLetterPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const confirmJoining = async (id: number, actualDateOfJoining: string, joiningRemarks: string | null) => {
  const res = await fetchWithAuth(`${BASE}/${id}/joining`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ActualDateOfJoining: actualDateOfJoining, JoiningRemarks: joiningRemarks }),
  });
  return handle<{ message: string }>(res);
};

export const deleteOfferLetter = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};

export const getOfferLetterTemplate = async (): Promise<{ TemplateId: number; Body: string }> => {
  const res = await fetchWithAuth(`${BASE}/template`);
  return handle(res);
};

export const updateOfferLetterTemplate = async (body: string) => {
  const res = await fetchWithAuth(`${BASE}/template`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Body: body }),
  });
  return handle<{ message: string }>(res);
};
