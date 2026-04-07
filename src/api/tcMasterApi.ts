const BASE_URL = "/api/tc-master"

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
})

export const getTCRecords = async () => {
  const res = await fetch(BASE_URL, { headers: getAuthHeaders() })
  if (!res.ok) throw new Error(`GET failed: ${res.status}`)
  return res.json()
}

export const addTCRecord = async (data: Record<string, unknown>) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "POST failed")
  }
  return res.json()
}

export const updateTCRecord = async (id: number, data: Record<string, unknown>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "PUT failed")
  }
  return res.json()
}

export const deleteTCRecord = async (id: number) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "DELETE failed")
  }
  return res.json()
}
