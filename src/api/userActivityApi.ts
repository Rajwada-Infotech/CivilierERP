import { fetchWithAuth } from '@/lib/fetchWithAuth'

interface UserActivityLog {
  id: string
  userId: string
  userName: string
  userEmail: string
  userRole: string
  event: 'login' | 'logout'
  timestamp: string
  ipAddress: string
  deviceInfo: string
}

interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  pages: number
}

export const getUserActivityLogs = async (params: {
  page?: number
  limit?: number
  search?: string
  event?: string
  role?: string
  sort?: string
  order?: 'asc' | 'desc'
} = {}): Promise<PaginatedResponse<UserActivityLog[]>> => {
  const url = new URL('/api/user-activity', window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  
  const response = await fetchWithAuth(url.pathname + url.search)
  if (!response.ok) throw new Error('Failed to fetch activity logs')
  return response.json()
}

export const logUserActivity = async (data: {
  userId: string
  userName: string
  userEmail: string
  userRole: string
  event: 'login' | 'logout'
  ipAddress?: string
  deviceInfo?: string
}) => {
  const response = await fetchWithAuth('/api/user-activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: data.userId,
      userName: data.userName,
      userEmail: data.userEmail,
      userRole: data.userRole,
      event: data.event,
      ipAddress: data.ipAddress,
      deviceInfo: data.deviceInfo
    })
  })
  if (!response.ok) throw new Error('Failed to log activity')
  return response.json()
}

export const subscribeToActivityStream = (onMessage: (data: any) => void): EventSource => {
  const token = localStorage.getItem("token");
  const url = token ? `/api/user-activity/stream?token=${token}` : '/api/user-activity/stream';
  const source = new EventSource(url)

  source.onmessage = (event) => {
    const data = JSON.parse(event.data)
    onMessage(data)
  }

  source.onerror = (err) => {
    console.error('SSE error:', err)
    // Auto-reconnect handled by EventSource
  }

  source.addEventListener('ping', (event) => {
    console.log('SSE ping received')
  })

  return source
}

