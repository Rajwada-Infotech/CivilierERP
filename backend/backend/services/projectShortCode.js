// Auto-derives and persists a Project's short_name whenever it's missing —
// so nothing downstream (Auto Project Setup's unit naming, or anything else
// that keys off a project's short code) ever blocks a user with a "go set
// this in Project Master first" detour. Shared between
// backend/routes/crmProjectAutoSetup.js (auto-sets on every /status call)
// and the one-time backfill run against existing projects that predate this.
const { sql } = require("../db");

const SHORT_CODE_RE = /^[A-Za-z0-9_-]{2,20}$/;

function isValidShortCode(code) {
  return SHORT_CODE_RE.test(String(code || "").trim());
}

// Initials of each word in the name (e.g. "Royal Garden" -> "RG"), falling
// back to the first 6 letters for a single-word name. Always uppercase,
// alphanumeric only.
function deriveShortCode(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).join("").toUpperCase();
    if (initials.length >= 2) return initials.slice(0, 20);
  }
  const merged = words.join("") || "PRJ";
  return merged.slice(0, 6).toUpperCase() || "PRJ";
}

// Appends an incrementing numeric suffix until the code doesn't collide with
// any other project's short_name. Bounded in practice by realistic project
// counts — this never loops more than a handful of times.
async function nextAvailableCode(pool, base, excludeId) {
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const r = await pool.request()
      .input("code", sql.NVarChar(100), candidate)
      .input("id", sql.Int, excludeId || 0)
      .query("SELECT TOP 1 id FROM dbo.enterprise WHERE short_name = @code AND id <> @id");
    if (!r.recordset.length) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 20);
  }
}

// If `project` (needs at least { Id, Name, ShortName }) has no valid Short
// Name yet, derives and persists one, collision-checked against every other
// project's short_name. Returns the (possibly just-created) valid code.
// No-ops and returns the existing value if it's already valid.
async function ensureProjectShortCode(pool, project) {
  const current = String(project.ShortName || "").trim();
  if (isValidShortCode(current)) return current;
  const base = deriveShortCode(project.Name);
  const code = await nextAvailableCode(pool, base, project.Id);
  await pool.request()
    .input("id", sql.Int, project.Id)
    .input("code", sql.NVarChar(100), code)
    .query("UPDATE dbo.enterprise SET short_name = @code WHERE id = @id");
  return code;
}

module.exports = { SHORT_CODE_RE, isValidShortCode, deriveShortCode, ensureProjectShortCode };
