/**
 * backend/services/faItemCodeGenerator.js
 *
 * Generates a batch of unique FA Item Codes in the shape
 * "ProjectAlias/ItemName/0001/FinYear", one per physically tagged unit.
 *
 * Uses sp_getapplock scoped to the transaction (same pattern as
 * backend/services/docNumber.js) so two concurrent "Generate ID" requests
 * for the same Project+Item+FinYear serialize instead of racing on the
 * same serial range — the lock releases automatically on commit/rollback.
 * A single MERGE increments the counter by the whole requested count in
 * one round trip and returns the new high-water mark, from which the
 * count contiguous codes are built.
 */
"use strict";

const { sql } = require("../db");

function sanitizeItemName(name) {
  // "/" is the code format's own delimiter — strip it so an item name can
  // never corrupt the shape of the generated code.
  return String(name || "Item").replace(/\//g, "-").trim() || "Item";
}

/**
 * @param {object} pool
 * @param {object} opts
 *   @param {number} opts.projectId
 *   @param {string} opts.projectAlias
 *   @param {string} opts.itemId
 *   @param {string} opts.itemName
 *   @param {string} opts.finYear
 *   @param {number} opts.count
 * @returns {Promise<string[]>} count sequential, unique FA Item Codes
 */
async function generateFAItemCodes(pool, { projectId, projectAlias, itemId, itemName, finYear, count }) {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("count must be a positive integer");
  }

  const resource = `faitemcode:${projectId}:${itemId}:${finYear}`;
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input("Resource",    sql.NVarChar(255), resource)
      .input("LockMode",    sql.NVarChar(32),  "Exclusive")
      .input("LockOwner",   sql.NVarChar(32),  "Transaction")
      .input("LockTimeout", sql.Int,           10000)
      .execute("sp_getapplock");

    const result = await tx.request()
      .input("ProjectId", sql.Int,           projectId)
      .input("ItemId",    sql.NVarChar(100), itemId)
      .input("FinYear",   sql.NVarChar(20),  finYear)
      .input("Count",     sql.Int,           count)
      .query(`
        MERGE dbo.FAItemCodeSequence AS tgt
        USING (SELECT @ProjectId AS ProjectId, @ItemId AS ItemId, @FinYear AS FinYear) AS src
          ON tgt.ProjectId = src.ProjectId AND tgt.ItemId = src.ItemId AND tgt.FinYear = src.FinYear
        WHEN MATCHED THEN UPDATE SET LastNumber = LastNumber + @Count
        WHEN NOT MATCHED THEN INSERT (ProjectId, ItemId, FinYear, LastNumber) VALUES (src.ProjectId, src.ItemId, src.FinYear, @Count)
        OUTPUT INSERTED.LastNumber;
      `);

    const newLastNumber = result.recordset[0].LastNumber;
    await tx.commit();

    const safeName = sanitizeItemName(itemName);
    const codes = [];
    for (let serial = newLastNumber - count + 1; serial <= newLastNumber; serial++) {
      codes.push(`${projectAlias}/${safeName}/${String(serial).padStart(4, "0")}/${finYear}`);
    }
    return codes;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

module.exports = { generateFAItemCodes };
