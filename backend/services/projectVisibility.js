// backend/services/projectVisibility.js
//
// A project is visible to (transactable against) a company if that company
// is either the project's primary/owning company (enterprise.company_id) or
// has been tagged onto the project via Project Master's multi-company
// tagging (dbo.ProjectCompanies, migration 451). Dropdowns already filter to
// this same rule client-side; this is the server-side backstop against a
// direct/stale API call submitting an untagged project/company pair.
const { sql } = require("../db");

async function assertProjectVisibleToCompany(pool, projectId, companyId) {
  const pid = parseInt(projectId, 10);
  const cid = parseInt(companyId, 10);
  if (!pid || !cid) return;

  const result = await pool
    .request()
    .input("pid", sql.Int, pid)
    .input("cid", sql.Int, cid)
    .query(`
      SELECT 1 AS ok
      FROM dbo.enterprise e
      WHERE e.id = @pid AND (
        e.company_id = @cid
        OR EXISTS (SELECT 1 FROM dbo.ProjectCompanies pc WHERE pc.ProjectId = e.id AND pc.CompanyId = @cid)
      )
    `);

  if (!result.recordset.length) {
    const err = new Error("This project is not available for the selected company.");
    err.status = 400;
    throw err;
  }
}

module.exports = { assertProjectVisibleToCompany };
