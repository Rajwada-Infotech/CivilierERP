import { fetchWithAuth } from '@/lib/fetchWithAuth'

export const getFinanceDashboard = () => fetchWithAuth('/api/finance-dashboard').then(r => r.json())

export const getMaterialDashboard = () => fetchWithAuth('/api/material-dashboard').then(r => r.json())

// Future: date-filtered reports
export const getReportsDashboard = () => fetchWithAuth('/api/reports').then(r => r.json())

export const getMonthlyReport = (year: number, month: number) => 
  fetchWithAuth(`/api/reports/monthly?year=${year}&month=${month}`).then(r => r.json())

