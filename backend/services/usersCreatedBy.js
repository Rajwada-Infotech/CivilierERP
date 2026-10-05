// dbo.users.CreatedBy arrives with migration 535. The Recent Activity feed and
// POST /api/users use it, but must keep working on a server where the migration
// hasn't run yet — so they ask first. A "yes" is cached for good; a "no" is
// re-checked after a minute, so applying the migration needs no restart.
let cached = false;
let checkedNoAt = 0;

async function usersHaveCreatedBy(pool) {
  if (cached) return true;
  if (Date.now() - checkedNoAt < 60_000) return false;
  const r = await pool
    .request()
    .query("SELECT COL_LENGTH('dbo.users', 'CreatedBy') AS len");
  if (r.recordset[0]?.len != null) {
    cached = true;
    return true;
  }
  checkedNoAt = Date.now();
  return false;
}

function resetUsersCreatedByCache() {
  cached = false;
  checkedNoAt = 0;
}

module.exports = { usersHaveCreatedBy, resetUsersCreatedByCache };
