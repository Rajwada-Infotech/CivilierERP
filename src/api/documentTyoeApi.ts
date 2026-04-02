const BASE_URL = "http://localhost:5000/api/document-type"

export const getDocumentTypes = async () => {
  const res = await fetch(BASE_URL)
  if (!res.ok) throw new Error(`GET failed: ${res.status}`)
  return res.json()
}

export const addDocumentType = async (data: Record<string, unknown>) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || "POST failed") }
  return res.json()
}

export const updateDocumentType = async (id: string, data: Record<string, unknown>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || "PUT failed") }
  return res.json()
}

export const deleteDocumentType = async (id: string) => {
  const res = await fetch(`${BASE_URL}/${id}`, { method: "DELETE" })
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || "DELETE failed") }
  return res.json()
}