const BASE_URL = "/api/entry-type"

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export const getEntryTypes = async () => {
  const res = await fetch(BASE_URL, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error(`GET failed: ${res.status}`)
  return res.json()
}

export const addEntryType = async (data: Record<string, unknown>) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  })
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || "POST failed") }
  return res.json()
}

export const updateEntryType = async (id: string, data: Record<string, unknown>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  })
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || "PUT failed") }
  return res.json()
}

export const deleteEntryType = async (id: string) => {
  const res = await fetch(`${BASE_URL}/${id}`, { method: "DELETE", headers: getAuthHeaders() })
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || "DELETE failed") }
  return res.json()
}