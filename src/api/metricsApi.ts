

interface SystemMetrics {
  rpm: number;
  activeUsers: number;
  memoryUsage: number;
  cacheHitRate: number;
  rpmHistory: number[];
  predictedHistory: number[];
  redisOk: boolean;
  workerOk: boolean;
  aofOk: boolean;
  lastUpdated: number;
}

export const fetchMetrics = async (baseURL: string, token?: string): Promise<SystemMetrics> => {
  const url = `${baseURL.replace(/\/$/, '')}/api/system/metrics`;
  const headers: Record<string, string> = { 
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const response = await fetch(url, { 
      headers, 
      signal: controller.signal 
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && 'name' in error && error.name === 'AbortError') {
      throw new Error('Request timeout (8s)');
    }
    throw error;
  }
};

// Demo data fallback for development/offline
export const getDemoMetrics = () => ({
  rpm: 42 + Math.floor(Math.random() * 20),
  activeUsers: 3 + Math.floor(Math.random() * 5),
  memoryUsage: 0.23 + Math.random() * 0.1,
  cacheHitRate: 0.72 + (Math.random() - 0.5) * 0.1,
  rpmHistory: Array.from({ length: 12 }, (_, i) => 30 + i * 2 + Math.random() * 10),
  predictedHistory: Array.from({ length: 12 }, (_, i) => 35 + i * 2.3 + Math.random() * 8),
  redisOk: true,
  workerOk: true,
  aofOk: true,
  lastUpdated: Date.now()
});

