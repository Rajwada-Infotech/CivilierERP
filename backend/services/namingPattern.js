// Naming patterns for generated units and parking slots (migration 527).
//
// A pattern is a template of tokens, created in CRM › Setup › Naming Patterns:
//   {P}    project short name            (required — keeps names unique across projects)
//   {T}    tower number = block's position in its project (1, 2, 3 … by creation order)
//   {B}    block name as typed           (A, 1, IRIS …)
//   {F}    floor label                   (pattern's GroundLabel for floor 0, else the number); {F:2} pads to 2 digits
//   {L}    letter of the unit on its floor (A, B … skipping the pattern's SkipLetters; Z → AA)
//   {N}    number of the unit on its floor, from NumberStart; {N:2} pads to 2 digits
//
// Resolution: floor override → block override → project default → none.
// "None" means today's fixed naming, so an unassigned project behaves exactly
// as before this feature existed.

const { sql } = require("../db");

const SCOPE = Object.freeze({ UNIT: "UNIT", PARKING: "PARKING" });
const TOKEN_RE = /\{(P|T|B|F|L|N)(?::(\d{1,2}))?\}/g;

// The legacy fixed names, kept as the "no pattern" behaviour.
function legacyName(scope, { shortCode, blockName, floorLabel, seq }) {
  const n2 = String(seq).padStart(2, "0");
  return scope === SCOPE.PARKING ? `${shortCode}/${blockName}/P${n2}` : `${shortCode}/${blockName}/${floorLabel}${n2}`;
}

/** Validate a template for a scope. Returns an error string or null. */
function validateTemplate(template, scope = SCOPE.UNIT) {
  const t = String(template || "");
  if (!t.trim()) return "Template is required";
  const stripped = t.replace(TOKEN_RE, "");
  if (/[{}]/.test(stripped)) return "Unknown token — use {P} {T} {B} {F} {L} {N} or {N:2}";
  if (!t.includes("{P}")) return "Template must include {P} (project short name) so names never clash across projects";
  if (!/\{(T|B)\}/.test(t)) return "Template must include {T} or {B} so blocks don't repeat each other's names";
  if (!/\{(L|N)(:\d{1,2})?\}/.test(t)) return "Template must include {L} or {N} so each unit on a floor gets its own name";
  if (scope === SCOPE.PARKING && /\{(F|L)\}/.test(t)) return "Parking has no floors or letters — use {P} {T} {B} {N}";
  if (scope === SCOPE.UNIT && !t.includes("{F}")) return "Unit template must include {F} (floor) so floors don't repeat each other's names";
  if (stripped.length > 60) return "Template has too much fixed text";
  return null;
}

/** nth letter (1-based) skipping the given letters: A, B … Z, AA, AB … */
function letterAt(n, skipLetters = "") {
  const skip = new Set(String(skipLetters || "").toUpperCase().replace(/[^A-Z]/g, "").split(""));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((c) => !skip.has(c));
  if (!alphabet.length) throw new Error("Every letter is skipped");
  let i = n - 1;
  let out = "";
  do {
    out = alphabet[i % alphabet.length] + out;
    i = Math.floor(i / alphabet.length) - 1;
  } while (i >= 0);
  return out;
}

/**
 * Render one name.
 * @param {object} pattern  row from CrmNamingPattern
 * @param {{shortCode:string, blockName:string, towerNo:number, floorNo?:number, seq:number}} ctx
 */
function renderName(pattern, ctx) {
  const floorLabel = ctx.floorNo === 0 ? pattern.GroundLabel || "G" : String(ctx.floorNo ?? "");
  const num = (pattern.NumberStart ?? 1) + ctx.seq - 1;
  return String(pattern.Template).replace(TOKEN_RE, (_m, tok, pad) => {
    switch (tok) {
      case "P": return ctx.shortCode;
      case "T": return String(ctx.towerNo);
      case "B": return ctx.blockName;
      // {F:2} pads numeric floors (0101 style); a lettered ground label isn't padded.
      case "F": return pad && /^\d+$/.test(floorLabel) ? floorLabel.padStart(parseInt(pad, 10), "0") : floorLabel;
      case "L": return letterAt(ctx.seq, pattern.SkipLetters);
      case "N": return pad ? String(num).padStart(parseInt(pad, 10), "0") : String(num);
      default: return "";
    }
  });
}

/** Tower number of each block = its position among the project's active blocks, by Id. */
async function towerNumbers(pool, projectId) {
  const r = await pool.request().input("pid", sql.Int, projectId)
    .query("SELECT Id FROM dbo.BlockMaster WHERE ProjectId = @pid AND IsActive = 1 ORDER BY Id");
  return new Map(r.recordset.map((b, i) => [b.Id, i + 1]));
}

/**
 * Effective pattern for a floor (units) or a block (parking): the most
 * specific assignment that points at an ACTIVE pattern of the right scope.
 * Returns null when nothing is assigned (legacy naming).
 */
async function resolvePattern(pool, { projectId, blockId, floorId = null, scope = SCOPE.UNIT }) {
  const col = scope === SCOPE.PARKING ? "ParkingNamingPatternId" : "UnitNamingPatternId";
  const r = await pool.request()
    .input("pid", sql.Int, projectId).input("bid", sql.Int, blockId).input("fid", sql.Int, floorId)
    .input("scope", sql.NVarChar(10), scope)
    .query(`
      SELECT TOP 1 np.Id, np.Name, np.Template, np.GroundLabel, np.SkipLetters, np.NumberStart
      FROM (VALUES
        (1, ${scope === SCOPE.UNIT ? "(SELECT UnitNamingPatternId FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @fid)" : "CAST(NULL AS INT)"}),
        (2, (SELECT ${col} FROM dbo.BlockMaster WHERE Id = @bid)),
        (3, (SELECT ${col} FROM dbo.enterprise WHERE id = @pid))
      ) v(Lvl, PatternId)
      JOIN dbo.CrmNamingPattern np ON np.Id = v.PatternId AND np.IsActive = 1 AND np.Scope = @scope
      ORDER BY v.Lvl`);
  return r.recordset[0] || null;
}

/** Name for one generated item — pattern if one applies, else the legacy name. */
function nameFor(pattern, scope, ctx) {
  return pattern ? renderName(pattern, ctx) : legacyName(scope, ctx);
}

module.exports = { SCOPE, validateTemplate, letterAt, renderName, legacyName, towerNumbers, resolvePattern, nameFor };
