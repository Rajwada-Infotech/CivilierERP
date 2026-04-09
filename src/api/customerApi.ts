import { fetchWithAuth } from '@/lib/fetchWithAuth'

const BASE = '/api/customerMaster'

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const getCustomers = () => fetchWithAuth(BASE).then(r => r.json())

export const addCustomer = (data: object) => 
  fetchWithAuth(BASE, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  }).then(r => r.json())

export const updateCustomer = (id: string, data: object) => 
  fetchWithAuth(`${BASE}/${id}`, { 
    method: 'PUT', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  }).then(r => r.json())

export const deleteCustomer = (id: string) => 
  fetchWithAuth(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json())

