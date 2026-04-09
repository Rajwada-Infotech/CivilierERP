import { fetchWithAuth } from '@/lib/fetchWithAuth'

const BASE = '/api/cardMaster'

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const getCardMasters = () => fetchWithAuth(BASE).then(r => r.json())

export const addCardMaster = (data: object) => 
  fetchWithAuth(BASE, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  }).then(r => r.json())

export const updateCardMaster = (id: string, data: object) => 
  fetchWithAuth(`${BASE}/${id}`, { 
    method: 'PUT', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  }).then(r => r.json())

export const deleteCardMaster = (id: string) => 
  fetchWithAuth(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json())

