import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/expense-booking"

export const getExpenseBookings = async () => {
  const res = await fetchWithAuth(BASE_URL)
  if (!res.ok) throw new Error(`GET failed: ${res.status}`)
  return res.json().catch(() => ({}))
}

export const addExpenseBooking = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "POST failed") }
  return res.json().catch(() => ({}))
}

export const updateExpenseBooking = async (id: string, data: Record<string, unknown>) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "PUT failed") }
  return res.json().catch(() => ({}))
}

export const deleteExpenseBooking = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" })
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "DELETE failed") }
  return res.json().catch(() => ({}))
}