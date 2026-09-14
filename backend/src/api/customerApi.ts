import { fetchWithAuth } from '@/lib/fetchWithAuth'

const BASE = '/api/account-head'

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const getCustomers = () => fetchWithAuth(BASE).then(r => r.json().catch(() => ({})))

export const addCustomer = (data: object) => 
  fetchWithAuth(BASE, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  }).then(r => r.json().catch(() => ({})))

export const updateCustomer = (id: string, data: object) => 
  fetchWithAuth(`${BASE}/${id}`, { 
    method: 'PUT', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  }).then(r => r.json().catch(() => ({})))

export const deleteCustomer = (id: string) => 
  fetchWithAuth(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json().catch(() => ({})))

