// Who may verify and approve in the Legal module — set by the super admin in Setup → Approval Control.
//
//   Verifier      verifies records and documents (the Verification / Review fields and document reviews)
//   Approver            approves, holds or rejects a land in Deed Process (one approval moves it to Deed Registration)
//   Legal Reviewer      gives legal clearance, clears court cases
//   Amendment Approver  approves or rejects changes to a registered land
// (The old "L1 Approver" / "L2 Approver" rows count as Approver until migration 700 merges them.)
//
// Administrators can always act. Until a stage has anyone listed in Approval Control, the old rule still
// applies (the approve right on the page), so nothing stops working before the list is set up.
// Maker-checker: the person who entered a record never verifies or approves it — only the super admin may.
const { getPool, sql } = require("../../db");
const { hasAnyPageAction } = require("../../middleware/requirePageRight");

const role = require("../../middleware/role");

const roleOf = (req) => String(req.user?.role || "").toLowerCase();
const userOf = (req) => req.user?.userId ?? req.user?.id ?? null;

/** Administrators: the only users who change the approval setup. */
const isAdmin = (req) => role.hasFullAccess(roleOf(req));
/** The super admin is the one exception to maker-checker. */
const isSuperAdmin = (req) => role.isSuperAdmin(roleOf(req));

/**
 * Can this user act at `stage`? `fallbackPage` is the page whose approve right counted before Approval
 * Control was set up; it still counts while nobody is listed for the stage.
 */
async function canAct(req, stage, fallbackPage) {
  if (isAdmin(req)) return true;
  // Before migration 608 the table is missing; the old rule applies then.
  const stages = stage === "Approver" ? ["Approver", "L1 Approver", "L2 Approver"] : [stage];
  const r = await getPool().request().input("Stage", sql.NVarChar(200), stages.join("|")).input("User", sql.Int, userOf(req)).query(`
    IF OBJECT_ID(N'dbo.LegalApprovalAuthority', N'U') IS NULL SELECT 0 AS listed, 0 AS mine
    ELSE SELECT COUNT(*) AS listed, SUM(CASE WHEN ApproverId = @User THEN 1 ELSE 0 END) AS mine
         FROM dbo.LegalApprovalAuthority WHERE Stage IN (SELECT value FROM STRING_SPLIT(@Stage, '|')) AND IsActive = 1`);
  const { listed, mine } = r.recordset[0];
  if (listed > 0) return mine > 0;
  return fallbackPage ? hasAnyPageAction(req, fallbackPage, ["approve"]) : false;
}

/** Refusal text when the user entered the record themselves (null when they may act). */
const ownWork = (req, enteredBy, what = "this record") =>
  !isSuperAdmin(req) && enteredBy != null && Number(enteredBy) === Number(userOf(req))
    ? `You entered ${what} — another user must verify or approve it`
    : null;

module.exports = { canAct, ownWork, isAdmin, isSuperAdmin, userOf };
