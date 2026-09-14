import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/enterprises";

export interface Enterprise {
  id: number;
  name: string | null;
  short_name: string | null;
  entity_type: string | null; // "Enterprise" | "Company" | "Business Unit"
  business_identity: string | null;
  business_type: string | null;
  b_sub_identity_type: string | null;
  belongs_to: number | null;
  logo: string | null;
  date_of_entry: string | null;
  date_of_establishment: string | null;
  start_date: string | null;
  start_fin_year: string | null;
  pan: string | null;
  cin: string | null;
  address: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  email: string | null;
  phone_number: string | null;
  gst_no?: string | null;
  pan_no?: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  gst_type: string | null;
  gst_issue_date: string | null;
  tan: string | null;
  rera_no: string | null;
  rera_date: string | null;
  trade_license: string | null;
  status: string | null;
  cr_code: string | null;
  discontinue: boolean | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json().catch(() => ({}));
}

export const getEnterprises = async (): Promise<Enterprise[]> => {
  const res = await fetchWithAuth(`${BASE_URL}?business_type=E`);
  const data = await handle<unknown>(res);
  return Array.isArray(data) ? (data as Enterprise[]) : [];
};

// Full records (with address/city/state etc.) filtered by business_type —
// used where the caller needs more than the slim {id,label} options list,
// e.g. to auto-fill a site location from a project's address.
export const getEnterprisesByType = async (
  businessType: string,
): Promise<Enterprise[]> => {
  const res = await fetchWithAuth(`${BASE_URL}?business_type=${businessType}`);
  const data = await handle<unknown>(res);
  return Array.isArray(data) ? (data as Enterprise[]) : [];
};

export const addEnterprise = async (data: Partial<Enterprise>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
};

export const updateEnterprise = async (
  id: string | number,
  data: Partial<Enterprise>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
};

export const deleteEnterprise = async (id: string | number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  return handle(res);
};

export const getEnterpriseOptions = async (
  type?: string,
  businessType?: string,
) => {
  const qs = new URLSearchParams();
  if (type) qs.set("type", type);
  if (businessType) qs.set("business_type", businessType);
  const url = qs.toString()
    ? `${BASE_URL}/options?${qs}`
    : `${BASE_URL}/options`;
  const res = await fetchWithAuth(url);
  return handle<
    {
      id: number;
      label: string;
      belongs_to: string | null;
      company_id: number | null;
    }[]
  >(res);
};

export interface CompanyDetail {
  id: number;
  name: string | null;
  short_name: string | null;
  logo: string | null;
  email: string | null;
  phone_number: string | null;
  address: string | null;
  address_line2?: string | null;
  city: string | null;
  state: string | null;
  pincode?: string | null;
  gst_no?: string | null;
  pan?: string | null;
}

export const getCompanyById = async (id: number): Promise<CompanyDetail> => {
  const res = await fetchWithAuth(`${BASE_URL}/by-id/${id}`);
  return handle<CompanyDetail>(res);
};
