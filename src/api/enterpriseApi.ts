import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/enterprises";

export interface Enterprise {
  id: number;
  name: string | null;
  short_name: string | null;
  entity_type: string | null;        // "Enterprise" | "Company" | "Business Unit"
  business_identity: string | null;
  business_type: string | null;
  b_sub_identity_type: string | null;
  belongs_to: number | null;
  logo: string | null;
  date_of_entry: string | null;
  date_of_establishment: string | null;
  start_date: string | null;
  start_fin_year: string | null;
  currency: string | null;
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
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  tds_limit: number | null;
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
  fiscal_year_start: string | null;
  cost_center: string | null;
  profit_center: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const getEnterprises = async (): Promise<Enterprise[]> => {
  const res = await fetchWithAuth(BASE_URL);
  return handle(res);
};

export const addEnterprise = async (data: Partial<Enterprise>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
};

export const updateEnterprise = async (id: string | number, data: Partial<Enterprise>) => {
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

export const getEnterpriseOptions = async (type?: string) => {
  const url = type ? `${BASE_URL}/options?type=${encodeURIComponent(type)}` : `${BASE_URL}/options`;
  const res = await fetchWithAuth(url);
  return handle<{ id: number; label: string }[]>(res);
};
