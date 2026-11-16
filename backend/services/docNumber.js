/**
 * Unified document numbering — every Campaign, Ad, Application, Booking,
 * Agreement, Service Ticket, Channel Partner, and Cancellation gets a
 * system-assigned unique number: PREFIX-YYYY-00001. Leads intentionally
 * keep their own LeadUid scheme and do not use this service.
 *
 * Uses sp_getapplock scoped to the transaction so concurrent requests for
 * the same doc type/year serialize instead of racing on the same sequence
 * value — the lock is released automatically on commit/rollback.
 */
const { sql } = require("../db");

async function getNextDocNumber(pool, docType, prefix, padLength = 5) {
  const year = new Date().getFullYear();
  const resource = `docnum:${docType}:${year}`;
  // A caller may already be inside a larger atomic operation (for example, creating a CRM application and its
  // inventory holds together). Reuse that transaction instead of opening a second connection/transaction.
  const ownsTransaction = typeof pool.transaction === "function";
  const tx = ownsTransaction ? pool.transaction() : pool;
  if (ownsTransaction) await tx.begin();
  try {
    await tx.request()
      .input("Resource",    sql.NVarChar(255), resource)
      .input("LockMode",    sql.NVarChar(32),  "Exclusive")
      .input("LockOwner",   sql.NVarChar(32),  "Transaction")
      .input("LockTimeout", sql.Int,           10000)
      .execute("sp_getapplock");

    const result = await tx.request()
      .input("docType", sql.NVarChar(20), docType)
      .input("year",    sql.Int,          year)
      .query(`
        MERGE dbo.CrmDocNumberSequence AS tgt
        USING (SELECT @docType AS DocType, @year AS Year) AS src
          ON tgt.DocType = src.DocType AND tgt.Year = src.Year
        WHEN MATCHED THEN UPDATE SET LastNumber = LastNumber + 1
        WHEN NOT MATCHED THEN INSERT (DocType, Year, LastNumber) VALUES (src.DocType, src.Year, 1)
        OUTPUT INSERTED.LastNumber;
      `);

    const seq = result.recordset[0].LastNumber;
    if (ownsTransaction) await tx.commit();
    return `${prefix}-${year}-${String(seq).padStart(padLength, "0")}`;
  } catch (e) {
    if (ownsTransaction) await tx.rollback();
    throw e;
  }
}

module.exports = { getNextDocNumber };
