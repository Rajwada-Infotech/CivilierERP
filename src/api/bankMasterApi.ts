import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/bank-master";

async function handleResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Helper Functions (Frontend)
const cleanIfsc = (value) => {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim().toUpperCase();
};

const cleanAccountType = (value) => {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim();
};

// GET ALL BANKS
export const getBanks = async () => {
  const res = await fetchWithAuth(BASE);
  return handleResponse(res);
};

// ADD BANK
export const addBank = async (formData) => {
  const payload = {
    BName: formData.BName?.trim() || null,
    BBranch: formData.BBranch?.trim() || null,
    BAccountNumber: formData.BAccountNumber?.trim() || null,
    BIfscCode: cleanIfsc(formData.BIfscCode),
    BAccountType: cleanAccountType(formData.BAccountType),
    BBankType: formData.BBankType?.trim() || null,
    BAccountHolderName: formData.BAccountHolderName?.trim() || null,
    BOpeningBalance: Number(formData.BOpeningBalance) || 0,
    BAddress: formData.BAddress?.trim() || null,
    BStatus: formData.BStatus ?? true,
    CompanyName: formData.CompanyName?.trim() || null,
  };

  console.log("Sending payload to backend:", payload); // For debugging

  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
};

// UPDATE BANK
export const updateBank = async (id, formData) => {
  const payload = {
    BName: formData.BName?.trim() || null,
    BIfscCode: cleanIfsc(formData.BIfscCode),
    BAccountType: cleanAccountType(formData.BAccountType),
    BStatus: formData.BStatus ?? null,
    BAddress: formData.BAddress?.trim() || null,
  };

  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
};

// DELETE BANK
export const deleteBank = async (id) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
