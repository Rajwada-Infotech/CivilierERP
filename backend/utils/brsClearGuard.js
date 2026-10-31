// BRS: only an Approved document can be ticked/cleared or bounced.
//
// This is the one place the rule lives. The /brs clear, bounce and legacy
// match routes refuse anything else (so the mobile app, old APKs and direct
// API calls are held to it too), and the BRS list reports Clearable per row
// from the same rule so the web and mobile screens only reflect it.
// Un-clear is deliberately NOT guarded: a mistake must stay fixable.

const { sql } = require("../db");

// Where each BRS SourceType's document lives and which column is its status.
// `status: null` = a document with no approval of its own: it only reaches BRS
// once approved/disbursed (the list shows it as 'Approved'), so it counts as
// approved when the row exists. Table/column names come only from this map.
const BRS_SOURCES = {
  PAYMENT:           { table: "dbo.NewPayment",        id: "PPaymentID",  status: "Status",   doc: "DocNo" },
  RECEIVED:          { table: "dbo.ReceivedPayment",   id: "RPPaymentID", status: "RPStatus", doc: "RPDocNo" },
  FUND_TRANSFER_OUT: { table: "dbo.FundTransfer",      id: "FTId",        status: "Status",   doc: "DocNo" },
  FUND_TRANSFER_IN:  { table: "dbo.FundTransfer",      id: "FTId",        status: "Status",   doc: "DocNo" },
  CRM_RECEIVED:      { table: "dbo.CrmPaymentReceipt", id: "Id",          status: null,       doc: "ReceiptNo" },
  LOAN_DISBURSED:    { table: "dbo.LoanSanction",      id: "LoanId",      status: null,       doc: "LoanNo" },
  LOAN_RECEIVED:     { table: "dbo.LoanSanction",      id: "LoanId",      status: null,       doc: "LoanNo" },
};

// Whitelist: only "Approved" (trimmed, any case). Pending, Rejected, Draft and
// any status added later are blocked by default.
const isApprovedStatus = (status) => String(status ?? "").trim().toLowerCase() === "approved";

const NOT_CLEARABLE_REASON = "Approve this document before clearing";

/**
 * Re-reads each document's status inside the caller's transaction, locking the
 * row so it cannot change mid-clear. Returns the ones that may not be cleared
 * (empty array = all fine). `items`: [{ SourceType, SourceID }].
 */
async function findUnapproved(tx, items) {
  const blocked = [];
  for (const { SourceType, SourceID } of items) {
    const s = BRS_SOURCES[SourceType];
    if (!s) { blocked.push({ SourceType, SourceID, Status: "unknown source type" }); continue; }
    const r = await tx.request().input("id", sql.Int, SourceID).query(
      `SELECT ${s.status ? s.status : "'Approved'"} AS Status, ${s.doc} AS DocNo
       FROM ${s.table} WITH (UPDLOCK, HOLDLOCK) WHERE ${s.id} = @id`);
    const row = r.recordset[0];
    if (!row || !isApprovedStatus(row.Status)) {
      blocked.push({ SourceType, SourceID, DocNo: row?.DocNo ?? null, Status: row?.Status ?? "not found" });
    }
  }
  return blocked;
}

/** The refusal body every guarded route sends. */
function unapprovedResponse(blocked) {
  const list = blocked.map((b) => `${b.DocNo || `${b.SourceType} #${b.SourceID}`} (${b.Status})`).join(", ");
  return { error: `Only approved documents can be cleared — ${list}`, blocked };
}

module.exports = { BRS_SOURCES, isApprovedStatus, findUnapproved, unapprovedResponse, NOT_CLEARABLE_REASON };
