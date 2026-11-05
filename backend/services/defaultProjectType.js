// A project saved with no Project Type gets the master's default: the first
// active type by SortOrder (the same one the pickers list first). Keeps
// "unselected" from leaving the project untyped, without hardcoding an Id.

async function resolveProjectTypeId(pool, raw) {
  if (raw != null && raw !== "") return parseInt(raw, 10);
  const r = await pool.request().query(
    "SELECT TOP 1 Id FROM dbo.ProjectTypeMaster WHERE IsActive = 1 ORDER BY SortOrder, Name");
  return r.recordset[0]?.Id ?? null;
}

module.exports = { resolveProjectTypeId };
