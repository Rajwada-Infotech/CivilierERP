import { fetchWithAuth } from '@/lib/fetchWithAuth';
import { cleanStr } from '@/lib/utils';

const BUSINESS_UNIT_URL = '/api/business-units';

// ================= TYPES =================
export interface BusinessUnit {
  id: number;
  Name: string;
  Code: string | null;
  Description: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface CreateBusinessUnitPayload {
  Name: string;
  Code?: string;
  Description?: string;
  IsActive?: boolean;
}

export interface UpdateBusinessUnitPayload {
  Name?: string;
  Code?: string;
  Description?: string;
  IsActive?: boolean;
}

// ================= HELPER =================
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }
  return response.json();
}

// ================= CRUD =================

// GET
export const getBusinessUnits = async (params?: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<{
  data: BusinessUnit[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> => {
  const url = new URL(BUSINESS_UNIT_URL, window.location.origin);

  if (params?.page) url.searchParams.set('page', params.page.toString());
  if (params?.limit) url.searchParams.set('limit', params.limit.toString());
  if (params?.search) url.searchParams.set('search', params.search);

  const res = await fetchWithAuth(url.toString());
  return handleResponse(res);
};

// CREATE
export const createBusinessUnit = async (
  data: CreateBusinessUnitPayload
): Promise<{ message: string; data: BusinessUnit }> => {
  const res = await fetchWithAuth(BUSINESS_UNIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      Name: cleanStr(data.Name),
      Code: cleanStr(data.Code || ''),
      Description: cleanStr(data.Description || ''),
    }),
  });

  return handleResponse(res);
};

// UPDATE
export const updateBusinessUnit = async (
  id: number,
  data: UpdateBusinessUnitPayload
): Promise<{ message: string; data: BusinessUnit }> => {
  const res = await fetchWithAuth(`${BUSINESS_UNIT_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      Name: data.Name ? cleanStr(data.Name) : undefined,
      Code: data.Code ? cleanStr(data.Code) : undefined,
      Description: data.Description ? cleanStr(data.Description) : undefined,
    }),
  });

  return handleResponse(res);
};

// DELETE
export const deleteBusinessUnit = async (
  id: number
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BUSINESS_UNIT_URL}/${id}`, {
    method: 'DELETE',
  });

  return handleResponse(res);
};

// ================= OPTIONS =================
export const getBusinessUnitOptions = async (): Promise<
  { id: number; label: string; Code?: string }[]
> => {
  const res = await fetchWithAuth(`${BUSINESS_UNIT_URL}/options`);
  return handleResponse(res);
};