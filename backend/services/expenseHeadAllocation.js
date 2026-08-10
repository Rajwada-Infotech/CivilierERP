/**
 * expenseHeadAllocation.js — shared helpers for dbo.ExpenseHeadAllocation
 * (migration 303), the multi-GL-head tagging table used by:
 *
 *   - ExpenseBooking direct/DINV bookings — replaces the old single
 *     EGLAccountId dropdown with a repeatable list of Expense Head +
 *     Amount rows that must sum to the invoice's own total.
 *   - NewPayment "Direct Expense Payment" mode — paying one or more
 *     Expense Heads directly, without a linked invoice/party.
 *
 * Rows are always replaced wholesale (delete-then-insert) on save rather
 * than diffed — the list is short (a handful of rows at most) and this
 * avoids any partial-update bookkeeping.
 */

const VALID_SOURCE_TYPES = new Set(["ExpenseBooking", "NewPayment"]);

/** Coerce a raw `[{ lHeadId, amount }]` (or PascalCase) body array into a
 *  clean, validated shape. Silently drops rows with no head or a
 *  non-positive amount — callers decide whether an empty result is an
 *  error (e.g. "at least one allocation required") or just "not using
 *  this feature". */
function normalizeAllocations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      lHeadId: parseInt(r?.lHeadId ?? r?.LHeadId, 10),
      amount: Math.round((Number(r?.amount ?? r?.Amount) || 0) * 100) / 100,
    }))
    .filter((r) => Number.isInteger(r.lHeadId) && r.lHeadId > 0 && r.amount > 0);
}

function sumAllocations(allocations) {
  return Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
}

/**
 * Replace every allocation row for one source record.
 * @param {() => import('mssql').Request} requestFactory - returns a fresh
 *   `.request()` bound to whatever transaction/pool the caller is using
 *   (a plain `sql.Request` can't be reused across multiple queries).
 */
async function replaceAllocations(requestFactory, sql, sourceType, sourceId, allocations) {
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    throw new Error(`Invalid ExpenseHeadAllocation sourceType: ${sourceType}`);
  }
  await requestFactory()
    .input("SourceType", sql.NVarChar(30), sourceType)
    .input("SourceId", sql.Int, sourceId)
    .query(
      "DELETE FROM dbo.ExpenseHeadAllocation WHERE SourceType=@SourceType AND SourceId=@SourceId",
    );
  for (const a of allocations) {
    await requestFactory()
      .input("SourceType", sql.NVarChar(30), sourceType)
      .input("SourceId", sql.Int, sourceId)
      .input("LHeadId", sql.Int, a.lHeadId)
      .input("Amount", sql.Decimal(18, 2), a.amount)
      .query(
        "INSERT INTO dbo.ExpenseHeadAllocation (SourceType, SourceId, LHeadId, Amount) VALUES (@SourceType, @SourceId, @LHeadId, @Amount)",
      );
  }
}

/** Allocation rows for one source record, joined to their GL head's name/code. */
async function getAllocations(pool, sql, sourceType, sourceId) {
  const r = await pool
    .request()
    .input("SourceType", sql.NVarChar(30), sourceType)
    .input("SourceId", sql.Int, sourceId).query(`
      SELECT a.AllocationId, a.LHeadId, a.Amount, ah.LHeadName, ah.LHeadCode
      FROM dbo.ExpenseHeadAllocation a
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = a.LHeadId
      WHERE a.SourceType = @SourceType AND a.SourceId = @SourceId
      ORDER BY a.AllocationId
    `);
  return r.recordset.map((row) => ({
    allocationId: row.AllocationId,
    lHeadId: row.LHeadId,
    amount: Number(row.Amount),
    lHeadName: row.LHeadName,
    lHeadCode: row.LHeadCode,
  }));
}

/** Batch fetch for a list of source ids at once (list-view endpoints) —
 *  returns a Map<sourceId, allocationRow[]>. */
async function getAllocationsForMany(pool, sql, sourceType, sourceIds) {
  const ids = [...new Set(sourceIds)].filter((id) => Number.isInteger(id) && id > 0);
  const map = new Map();
  if (ids.length === 0) return map;
  const req = pool.request().input("SourceType", sql.NVarChar(30), sourceType);
  const placeholders = ids.map((id, i) => {
    req.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const r = await req.query(`
    SELECT a.SourceId, a.AllocationId, a.LHeadId, a.Amount, ah.LHeadName, ah.LHeadCode
    FROM dbo.ExpenseHeadAllocation a
    JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = a.LHeadId
    WHERE a.SourceType = @SourceType AND a.SourceId IN (${placeholders.join(",")})
    ORDER BY a.AllocationId
  `);
  for (const row of r.recordset) {
    const list = map.get(row.SourceId) || [];
    list.push({
      allocationId: row.AllocationId,
      lHeadId: row.LHeadId,
      amount: Number(row.Amount),
      lHeadName: row.LHeadName,
      lHeadCode: row.LHeadCode,
    });
    map.set(row.SourceId, list);
  }
  return map;
}

module.exports = {
  normalizeAllocations,
  sumAllocations,
  replaceAllocations,
  getAllocations,
  getAllocationsForMany,
};
