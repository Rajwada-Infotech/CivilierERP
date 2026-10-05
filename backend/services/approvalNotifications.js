/**
 * approvalNotifications.js — who gets a phone push when an approval moves.
 *
 *   - A document is submitted, or a level is cleared and the next one opens
 *       -> the people who can act on that next level ("Approval needed").
 *   - A document is finally approved or rejected
 *       -> the person who submitted it.
 *
 * Called by approvalService.transition() AFTER its transaction commits, and
 * never allowed to throw into it. Takes the already-resolved workflow level
 * definitions instead of importing approvalService (that would be circular).
 */
"use strict";

const { getPool, sql } = require("../db");
const logger = require("../logger");
const { sendToUsers } = require("./pushNotifications");

// Apps where an approver can act on / see approvals. An approval push goes only to
// these, so someone logged into several Civilier apps isn't pinged on all of them.
const APPROVAL_APPS = ["admin", "finance-material"];

const MODULE_LABELS = {
  "expense-booking": "Expense Booking",
  "purchase-orders": "Purchase Order",
  "work-orders": "Work Order",
  boq: "BOQ",
  "work-done": "Work Done",
  grn: "GRN",
  "goods-receipt": "GRN",
  payments: "Payment",
  "crm-refund-payment": "Refund Payment",
  "material-requests": "Material Request",
  "material-issues": "Material Issue",
  "material-issue-return": "Issue Return",
  "sale-orders": "Sale Order",
  "vehicle-in-out": "Vehicle In/Out",
  "stock-transfers": "Stock Transfer",
  "journal-voucher": "Journal Voucher",
  "inter-company-transfer": "Inter-Company Transfer",
  "fund-transfer": "Fund Transfer",
  "debit-note": "Debit Note",
};

function moduleLabel(module) {
  return (
    MODULE_LABELS[module] ||
    String(module || "Document").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Active users holding any of these role names ("Super Admin" matches super_admin). */
async function userIdsByRoles(roleNames) {
  const names = [...new Set((roleNames || []).map((r) => String(r).toLowerCase().replace(/\s+/g, "_")).filter(Boolean))];
  if (!names.length) return [];
  const req = getPool().request();
  const ph = names.map((n, i) => {
    req.input(`r${i}`, sql.NVarChar(100), n);
    return `@r${i}`;
  });
  const r = await req.query(`
    SELECT u.id FROM dbo.users u
    JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE LOWER(REPLACE(r.RName, ' ', '_')) IN (${ph.join(",")}) AND ISNULL(u.discontinue, 0) = 0
  `);
  return r.recordset.map((x) => Number(x.id));
}

async function userIdByEmail(email) {
  if (!email) return null;
  const r = await getPool()
    .request()
    .input("e", sql.NVarChar(200), email)
    .query("SELECT TOP 1 id FROM dbo.users WHERE LOWER(email) = LOWER(@e) AND ISNULL(discontinue, 0) = 0");
  return r.recordset[0] ? Number(r.recordset[0].id) : null;
}

/** The document number, when the doc-number log knows it (most modules); otherwise empty. */
async function docNumberOf(tableName, id) {
  try {
    const r = await getPool()
      .request()
      .input("t", sql.NVarChar(100), tableName)
      .input("id", sql.Int, Number(id))
      .query("SELECT TOP 1 DocNo FROM dbo.DocNumberSequence WHERE TableName = @t AND RecordId = @id");
    return r.recordset[0]?.DocNo || "";
  } catch {
    return "";
  }
}

/** Who can act on a level: its named users, plus everyone in its named roles; else the module's default approver roles. */
async function approversOfLevel(levelDef, defaultRoles) {
  const named = Array.isArray(levelDef?.userIds) ? levelDef.userIds.map(Number) : [];
  const roles = Array.isArray(levelDef?.roles) ? levelDef.roles : [];
  if (!named.length && !roles.length) return userIdsByRoles(defaultRoles);
  const byRole = roles.length ? await userIdsByRoles(roles) : [];
  return [...named, ...byRole];
}

/**
 * @param {object} p
 * @param {string} p.module        approval module slug
 * @param {string} p.tableName     e.g. "PurchaseOrders" (no schema)
 * @param {number|string} p.id
 * @param {"Pending"|"Approved"|"Rejected"} p.targetStatus  what the caller asked for
 * @param {object} p.result        transition()'s result ({ newStatus, level, waitingOnLevel, ... })
 * @param {number|null} p.actorUserId   whoever just acted — never notified about their own action
 * @param {object[]} p.levelDefs   the workflow's level definitions
 * @param {string[]} p.defaultRoles  module-wide approver roles, for levels that name nobody
 */
async function notifyTransition(p) {
  try {
    const { module, tableName, id, targetStatus, result, actorUserId, levelDefs = [], defaultRoles = [] } = p;
    const label = moduleLabel(module);
    const data = { module, recordId: Number(id), tableName };

    // Which level is now waiting, if any.
    let waitingLevel = null;
    if (targetStatus === "Pending") waitingLevel = 1;
    else if (targetStatus === "Approved" && result?.newStatus === "Pending" && !result?.waitingOnLevel) {
      waitingLevel = Number(result.level) + 1;
    }

    if (waitingLevel != null) {
      const levelDef = levelDefs[waitingLevel - 1];
      const recipients = (await approversOfLevel(levelDef, defaultRoles)).filter((u) => u !== actorUserId);
      if (!recipients.length) return;
      const doc = await docNumberOf(tableName, id);
      await sendToUsers(recipients, {
        title: "Approval needed",
        body: `${label}${doc ? ` ${doc}` : ""} is waiting for your approval.`,
        data: { ...data, type: "approval-waiting" },
      }, { apps: APPROVAL_APPS });
      return;
    }

    const finished =
      (targetStatus === "Approved" && result?.newStatus === "Approved") || targetStatus === "Rejected";
    if (!finished) return;

    // The submitter is the person on the most recent Level-0 "Pending" audit row.
    const sub = await getPool()
      .request()
      .input("t", sql.NVarChar(100), tableName)
      .input("id", sql.Int, Number(id))
      .query(`
        SELECT TOP 1 ApproverEmail FROM dbo.ApprovalAuditLog
        WHERE TableName = @t AND RecordId = @id AND Level = 0 AND ActionStatus = 'Pending'
        ORDER BY ActionAt DESC
      `);
    const submitterId = await userIdByEmail(sub.recordset[0]?.ApproverEmail);
    if (!submitterId || submitterId === actorUserId) return;

    const approved = targetStatus === "Approved";
    const doc = await docNumberOf(tableName, id);
    await sendToUsers([submitterId], {
      title: approved ? "Approved" : "Rejected",
      body: `Your ${label}${doc ? ` ${doc}` : ""} was ${approved ? "approved" : "rejected"}.`,
      data: { ...data, type: "approval-outcome", status: approved ? "Approved" : "Rejected" },
    }, { apps: APPROVAL_APPS });
  } catch (err) {
    logger.warn({ err: err.message, module: p?.module, id: p?.id }, "[push] approval notification failed");
  }
}

module.exports = { notifyTransition, moduleLabel, approversOfLevel, APPROVAL_APPS };
