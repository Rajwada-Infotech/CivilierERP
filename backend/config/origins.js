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

module.exports = { ALLOWED_ORIGINS };
