import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/employee-master";

export interface EmployeeRow {
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  PhotoBase64: string | null;
  DateOfBirth: string | null;
  Gender: string | null;
  Mobile: string | null;
  Email: string | null;
  Address: string | null;
  EmergencyContactName: string | null;
  EmergencyContactPhone: string | null;
  JoiningDate: string | null;
  ConfirmationDate: string | null;
  Department: string | null;
  Designation: string | null;
  BranchLocation: string | null;
  ReportingManagerId: number | null;
  ReportingManagerName: string | null;
  EmploymentType: string | null;
  GradeLevel: string | null;
  CostCenterId: number | null;
  CostCenterName: string | null;
  BankName: string | null;
  BankAccountNumber: string | null;
  BankIFSC: string | null;
  PAN: string | null;
  Aadhaar: string | null;
  UAN: string | null;
  ESICNumber: string | null;
  PFNumber: string | null;
  NomineeName: string | null;
  NomineeRelationship: string | null;
  NomineeContact: string | null;
  IsActive: boolean;
  DocumentCount: number;
  CreatedBy: string | null;
  CreatedAt: string;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

export interface EmployeePayload {
  EmployeeCode: string;
  EmployeeName: string;
  PhotoBase64?: string | null;
  DateOfBirth?: string | null;
  Gender?: string | null;
  Mobile?: string | null;
  Email?: string | null;
  Address?: string | null;
  EmergencyContactName?: string | null;
  EmergencyContactPhone?: string | null;
  JoiningDate?: string | null;
  ConfirmationDate?: string | null;
  Department?: string | null;
  Designation?: string | null;
  BranchLocation?: string | null;
  ReportingManagerId?: number | null;
  EmploymentType?: string | null;
  GradeLevel?: string | null;
  CostCenterId?: number | null;
  BankName?: string | null;
  BankAccountNumber?: string | null;
  BankIFSC?: string | null;
  PAN?: string | null;
  Aadhaar?: string | null;
  UAN?: string | null;
  ESICNumber?: string | null;
  PFNumber?: string | null;
  NomineeName?: string | null;
  NomineeRelationship?: string | null;
  NomineeContact?: string | null;
  IsActive?: boolean;
}

export interface EmployeeDocument {
  AttachmentId: number;
  EmployeeId: number;
  DocType: string;
  FileName: string;
  MimeType: string;
  FileSize: number;
  UploadedBy: string | null;
  UploadedAt: string;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getEmployees = async (): Promise<EmployeeRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const getEmployeeOptions = async (): Promise<
  { id: number; label: string; code: string }[]
> => {
  const res = await fetchWithAuth(`${BASE}/options`);
  return handle(res);
};

export const addEmployee = async (payload: EmployeePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; id: number }>(res);
};

export const updateEmployee = async (id: number, payload: EmployeePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteEmployee = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};

export const getEmployeeDocuments = (employeeId: number) =>
  fetchWithAuth(`${BASE}/${employeeId}/documents`).then((r) =>
    handle<EmployeeDocument[]>(r),
  );

export const uploadEmployeeDocument = (
  employeeId: number,
  file: File,
  docType: string,
) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("docType", docType);
  return fetchWithAuth(`${BASE}/${employeeId}/documents`, {
    method: "POST",
    body: formData,
  }).then((r) => handle<{ attachmentId: number; fileName: string }>(r));
};

export const deleteEmployeeDocument = (attachmentId: number) =>
  fetchWithAuth(`${BASE}/document/${attachmentId}`, { method: "DELETE" }).then(
    (r) => handle<{ message: string }>(r),
  );

export const employeeDocumentUrl = (attachmentId: number) =>
  `${BASE}/document/${attachmentId}`;
