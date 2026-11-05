// backend/services/paymentDimensions.js
//
// NewPayment.PCompany / PProject are text: the Payment form has always sent the company's and project's NAME ("Delta Realtech",
// "Delta Office"), while everything that reads them for money - the ledger posting, BRS, the PDC report, Project Master's
// counts - reads an enterprise ID ("3", "1029"). A payment saved with names therefore posted to the ledger with no company and
// no project (parseInt("Delta Realtech") is NaN) and skipped the project-belongs-to-company check.
//
// normalizePaymentDimensions turns a name into the matching enterprise id (a value that is already an id is kept; a name that
// matches nothing, or matches several projects and cannot be told apart, is left as it was). Used when a payment is saved and
// when it is posted, so a payment still holding names posts correctly too.
const { sql } = require("../db");

const isId = (v) => /^\d+$/.test(String(v ?? "").trim());

async function companyIdOf(pool, value) {
  const text = String(value ?? "").trim();
  if (!text || isId(text)) return text;
  const r = await pool.request().input("n", sql.NVarChar(255), text)
    .query("SELECT id FROM dbo.enterprise WHERE business_type = 'C' AND name = @n");
  return r.recordset.length === 1 ? String(r.recordset[0].id) : text;
}

// A project name can exist under more than one company; the company on the payment picks the right one.
async function projectIdOf(pool, value, companyId) {
  const text = String(value ?? "").trim();
  if (!text || isId(text)) return text;
  const r = await pool.request().input("n", sql.NVarChar(255), text).input("c", sql.Int, isId(companyId) ? parseInt(companyId, 10) : null)
    .query(`SELECT e.id,
                   CASE WHEN @c IS NOT NULL AND (e.company_id = @c OR EXISTS (SELECT 1 FROM dbo.ProjectCompanies pc WHERE pc.ProjectId = e.id AND pc.CompanyId = @c)) THEN 1 ELSE 0 END AS ofCompany
            FROM dbo.enterprise e WHERE e.business_type = 'P' AND e.name = @n`);
  if (r.recordset.length === 1) return String(r.recordset[0].id);
  const mine = r.recordset.filter((x) => x.ofCompany === 1);
  return mine.length === 1 ? String(mine[0].id) : text;
}

/** { PCompany, PProject } with names replaced by enterprise ids where they can be told apart; anything else is returned as it came. */
async function normalizePaymentDimensions(pool, { PCompany, PProject }) {
  const company = await companyIdOf(pool, PCompany);
  const project = await projectIdOf(pool, PProject, company);
  return { PCompany: company === "" ? PCompany : company, PProject: project === "" ? PProject : project };
}

module.exports = { normalizePaymentDimensions, companyIdOf, projectIdOf };
