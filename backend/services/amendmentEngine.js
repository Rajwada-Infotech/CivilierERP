// backend/services/amendmentEngine.js
//
// Applies an approved Amendment's ProposedChanges back onto the real
// document, then reverses and reposts that document's GL entry if it has
// one. ProposedChanges is a plain {column: value} map captured verbatim by
// the document's own PUT route at propose time (see routes/amendments.js
// POST /propose and the "Approved → propose instead of update" branch each
// module's PUT route grows) — this function does no business-rule
// recomputation of its own, it only writes back what was already validated
// and computed once, at propose time.

const { sql } = require("../db");
const { MODULE_MAP, GL_POSTERS } = require("./approvalService");
const { reversePostingBySource } = require("./generalLedger");
const { syncBillStatus } = require("../utils/syncBillStatus");

// module → the SourceType string that module's own postXApproval() function
// (services/generalLedger.js) uses when writing GeneralLedgerEntry rows.
// Only modules present here get their GL entry reversed + reposted on
// amendment apply; modules absent here (no GL impact) just get their row
// updated.
const GL_SOURCE_TYPE = {
  grn: "GRN",
  "goods-receipt": "GRN",
  "expense-booking": "ExpenseBooking",
  payments: "NewPayment",
  "journal-voucher": "JournalVoucher",
  "fund-transfer": "FundTransfer",
};

/**
 * Write ProposedChanges back onto the real document row, then reverse +
 * repost its GL entry (if the module posts to the ledger at all).
 *
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} module - MODULE_MAP key (same slugs approvalService.js uses)
 * @param {number} refDocId
 * @param {Record<string, unknown>} proposedChanges
 * @param {string} actor - approver's email, passed through to the GL poster
 */
async function applyAmendment(pool, module, refDocId, proposedChanges, actor) {
  const map = MODULE_MAP[module];
  if (!map) throw new Error(`Unknown amendment module: ${module}`);
  if (!proposedChanges || typeof proposedChanges !== "object") {
    throw new Error("No proposed changes to apply");
  }

  const keys = Object.keys(proposedChanges).filter(
    (k) => k.toLowerCase() !== map.pk.toLowerCase(),
  );
  if (keys.length === 0) return { updated: false, reposted: false };

  const request = pool.request().input("__id", sql.Int, refDocId);
  const setClauses = keys.map((k, i) => {
    const paramName = `__f${i}`;
    const value = proposedChanges[k];
    if (value === null || value === undefined) {
      request.input(paramName, sql.NVarChar, null);
    } else {
      request.input(paramName, value);
    }
    return `${k} = @${paramName}`;
  });

  const result = await request.query(
    `UPDATE ${map.table} SET ${setClauses.join(", ")} WHERE ${map.pk} = @__id`,
  );
  if (!result.rowsAffected?.[0]) {
    throw new Error(`Document not found: ${module} #${refDocId}`);
  }

  // An amendment to an Invoice can change ENetAmount and/or the TDS
  // snapshot (TDSAmount etc.) — both feed EBillStatus/ETotalPaid/
  // ERemainingAmount, which this generic column-by-column UPDATE has no
  // way to know it needs to recompute. Previously these three only ever
  // got refreshed by the /approve route (once, before any amendment
  // could exist) or by a payment being made — so an approved invoice
  // whose TDS was added/changed via an amendment kept showing its
  // pre-amendment (often pre-TDS) Remaining/Bill Status forever, even
  // though the invoice's own figures were correctly updated.
  if (module === "expense-booking") {
    try {
      const docRes = await pool.request().input("Eid", sql.Int, refDocId)
        .query("SELECT EDocNo FROM dbo.ExpenseBooking WHERE Eid = @Eid");
      const docNo = docRes.recordset[0]?.EDocNo;
      if (docNo) await syncBillStatus(pool, sql, docNo);
    } catch (syncErr) {
      console.warn("syncBillStatus on amendment apply failed (non-fatal):", syncErr.message);
    }
  }

  const sourceType = GL_SOURCE_TYPE[module];
  const poster = GL_POSTERS[module];
  if (sourceType && poster) {
    await reversePostingBySource(pool, sourceType, refDocId);
    await poster(pool, refDocId, actor);
    return { updated: true, reposted: true };
  }

  return { updated: true, reposted: false };
}

module.exports = { applyAmendment, GL_SOURCE_TYPE };
