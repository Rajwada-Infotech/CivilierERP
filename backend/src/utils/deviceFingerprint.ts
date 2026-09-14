/**
 * Device Fingerprinting Utility
 * Generates a stable device ID from browser characteristics.
 * NOTE: MAC addresses are NOT accessible from browser JS (browser security sandbox).
 * This fingerprint uses available signals: UA, screen, timezone, hardware concurrency, etc.
 */

export interface DeviceProfile {
  fingerprint: string;
  os: string;
  browser: string;
  browserVersion: string;
  isMobile: boolean;
  screen: string;
  colorDepth: number;
  timezone: string;
  language: string;
  cpuCores: number;
  deviceMemoryGB: number | null;
  platform: string;
  touchSupport: boolean;
}

export async function getDeviceFingerprint(): Promise<string> {
  const cacheKey = "deviceFingerprint_v2";
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  const characteristics = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages?.join(",") ?? "",
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    availScreen: `${screen.availWidth}x${screen.availHeight}`,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    cpuCores: navigator.hardwareConcurrency || 0,
    memory: (navigator as any).deviceMemory || 0,
    touchPoints: navigator.maxTouchPoints || 0,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
  };

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(characteristics));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  const fingerprint = hash.substring(0, 32);

  localStorage.setItem(cacheKey, fingerprint);
  return fingerprint;
}

function parseBrowser(ua: string): { browser: string; version: string } {
  const patterns: [RegExp, string][] = [
    [/Edg\/([0-9.]+)/, "Edge"],
    [/OPR\/([0-9.]+)/, "Opera"],
    [/Chrome\/([0-9.]+)/, "Chrome"],
    [/Firefox\/([0-9.]+)/, "Firefox"],
    [/Version\/([0-9.]+).*Safari/, "Safari"],
    [/MSIE ([0-9.]+)/, "IE"],
    [/Trident.*rv:([0-9.]+)/, "IE"],
  ];
  for (const [re, name] of patterns) {
    const m = ua.match(re);
    if (m) return { browser: name, version: m[1].split(".")[0] };
  }
  return { browser: "Unknown", version: "" };
}

function parseOS(ua: string): string {
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows NT 6.3/.test(ua)) return "Windows 8.1";
  if (/Windows NT 6.1/.test(ua)) return "Windows 7";
  if (/Windows/.test(ua)) return "Windows";
  if (/iPhone OS ([0-9_]+)/.test(ua))
    return `iOS ${ua.match(/iPhone OS ([0-9_]+)/)?.[1]?.replace(/_/g, ".") ?? ""}`;
  if (/iPad/.test(ua)) return "iPadOS";
  if (/Android ([0-9.]+)/.test(ua))
    return `Android ${ua.match(/Android ([0-9.]+)/)?.[1] ?? ""}`;
  if (/Mac OS X ([0-9_]+)/.test(ua))
    return `macOS ${ua.match(/Mac OS X ([0-9_]+)/)?.[1]?.replace(/_/g, ".") ?? ""}`;
  if (/Linux/.test(ua)) return "Linux";
  if (/CrOS/.test(ua)) return "ChromeOS";
  return "Unknown OS";
}

/** Returns full raw User-Agent string — the server stores this and parses it server-side too */
export function getDeviceInfo(): string {
  return navigator.userAgent;
}

export function parseDeviceInfo(ua: string = ""): DeviceProfile {
  const { browser, version } = parseBrowser(ua);
  const os = parseOS(ua);
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);

  return {
    fingerprint: "",
    os,
    browser,
    browserVersion: version,
    isMobile,
    screen: `${screen.width}×${screen.height}`,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    cpuCores: navigator.hardwareConcurrency || 0,
    deviceMemoryGB: (navigator as any).deviceMemory ?? null,
    platform: navigator.platform,
    touchSupport: navigator.maxTouchPoints > 0,
  };
}

export function clearFingerprintCache(): void {
  localStorage.removeItem("deviceFingerprint_v1");
  localStorage.removeItem("deviceFingerprint_v2");
}

/**
 * Cryptographically secure UUID v4 generator.
 * Prefers the native crypto.randomUUID() (available in secure contexts / HTTPS).
 * Falls back to crypto.getRandomValues() for HTTP / non-secure contexts.
 * Never uses Math.random().
 */
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // RFC 4122 §4.4 — version 4, variant 10xx
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
