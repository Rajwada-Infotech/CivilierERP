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

export const getUserActivityLogs = async (): Promise<UserActivityLog[]> => {
  const response = await fetchWithAuth('/api/user-activity')
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

