const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:5173",
  "http://[::1]:3000",
  "http://[::1]:8080",
  "http://[::1]:8081",
  "http://[::1]:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
];

const PRODUCTION_ORIGINS = [
  "https://civiliererp.vercel.app",
  "https://civiliererp.in",
  "https://www.civiliererp.in",
];

// RFC 1918 private network ranges — allowed in dev so LAN access works
// e.g. http://192.168.1.5:8081 from another device on the same Wi-Fi
const PRIVATE_IP_RE =
  /^https?:\/\/(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/;

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const configuredOrigins = parseOrigins(
  process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN,
);

const ALLOWED_ORIGINS =
  configuredOrigins.length > 0
    ? configuredOrigins
    : process.env.NODE_ENV === "production"
      ? PRODUCTION_ORIGINS
      : [...LOCAL_ORIGINS, ...PRODUCTION_ORIGINS];

const isDev = process.env.NODE_ENV !== "production";

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (isDev && PRIVATE_IP_RE.test(origin)) return true;
  return false;
}

module.exports = { ALLOWED_ORIGINS, isOriginAllowed };
