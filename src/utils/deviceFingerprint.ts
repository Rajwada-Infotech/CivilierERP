/**
 * Device Fingerprinting Utility - Privacy-friendly device identification
 * Generates unique ID from browser characteristics (NOT MAC address)
 */

export async function getDeviceFingerprint(): Promise<string> {
  const cacheKey = 'deviceFingerprint_v1';
  
  // Return cached value if available
  if (localStorage.getItem(cacheKey)) {
    return localStorage.getItem(cacheKey)!;
  }

  // Collect device characteristics
  const characteristics = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cpuCores: navigator.hardwareConcurrency || 0,
    memory: (navigator as any).deviceMemory || 0,
  };

  // Simple hash function
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(characteristics));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Cache and return first 32 chars
  const fingerprint = hash.substring(0, 32);
  localStorage.setItem(cacheKey, fingerprint);
  
  return fingerprint;
}

export function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  let os = 'Unknown';
  let browser = 'Unknown';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS'; 
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';

  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  return `${isMobile ? 'Mobile' : 'Desktop'} • ${browser} • ${os}`;
}

export function clearFingerprintCache(): void {
  localStorage.removeItem('deviceFingerprint_v1');
}

