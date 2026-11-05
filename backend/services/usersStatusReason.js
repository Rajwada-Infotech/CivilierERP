// dbo.users.StatusReason / StatusChangedAt / StatusChangedBy arrive with migration 621. The users list and PUT /api/users/:id use
// them but must keep working on a server where the migration has not run yet, so they ask first. A "yes" is cached for good; a "no"
// is re-checked after a minute, so applying the migration needs no restart.
let cached = false;
let checkedNoAt = 0;

async function usersHaveStatusReason(pool) {
  if (cached) return true;
  if (Date.now() - checkedNoAt < 60_000) return false;
  const r = await pool.request().query("SELECT COL_LENGTH('dbo.users', 'StatusReason') AS len");
  if (r.recordset[0]?.len != null) {
    cached = true;
    return true;
  }
  checkedNoAt = Date.now();
  return false;
}

module.exports = { usersHaveStatusReason };
