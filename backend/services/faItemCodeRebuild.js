/**
 * backend/services/faItemCodeRebuild.js
 *
 * Keeps FixedAssetRecord.FAItemCode in step with who currently holds the
 * asset. Two stages:
 *   FA Inventory (Tagging):  TR/Mobile/0011/FY 2026-27
 *   After Assignment/Transfer: TR/IT/Mobile/0011/26-27
 * (the custodian's department is inserted after the project alias, and the
 * financial year segment is shortened).
 *
 * The Tagging row's own FAItemCode (dbo.FixedAssetTagging.FAItemCode) is the
 * immutable original — it's never touched, so it always reads back exactly
 * what FA Inventory generated. FixedAssetRecord.FAItemCode is the "current"
 * value shown everywhere else (Assignment, Transfer, Quality Check,
 * Maintenance, Depreciation Tag) and IS rewritten here, always rebuilt fresh
 * from that immutable base plus whoever holds the asset right now — never
 * from its own previous value — so repeated reassignment/transfer can never
 * compound into a corrupted code.
 */
"use strict";

const { sql } = require("../db");

const FY_LONG = /^FY\s+(\d{4})-(\d{2,4})$/i;

// "FY 2026-27" -> "26-27". Leaves anything that doesn't match this exact
// long shape untouched (defensive — an unexpected format should never throw
// or silently mangle the code).
function shortFinYear(seg) {
  const m = FY_LONG.exec(String(seg || "").trim());
  if (!m) return seg;
  const endShort = m[2].length === 4 ? m[2].slice(-2) : m[2];
  return `${m[1].slice(-2)}-${endShort}`;
}

function sanitizeSegment(name, fallback) {
  // "/" is the code format's own delimiter — never let a department/item
  // name corrupt the shape of the generated code.
  return String(name || fallback).replace(/\//g, "-").trim() || fallback;
}

/**
 * Builds the "current" code from the immutable base ("Alias/Item/Serial/
 * FinYear") and the holder's department name (or null/undefined for no
 * current holder / no department on file — the code then stays in its
 * plain Inventory-stage shape, just with the FinYear shortened).
 * Returns null if `baseCode` isn't the standard 4-segment shape (a
 * hand-typed or otherwise non-standard code is left alone).
 */
function buildCurrentCode(baseCode, departmentName) {
  if (!baseCode) return null;
  const parts = String(baseCode).split("/");
  if (parts.length !== 4) return null;
  const [alias, item, serial, finYear] = parts;
  const fy = shortFinYear(finYear);
  if (!departmentName) return `${alias}/${item}/${serial}/${fy}`;
  return `${alias}/${sanitizeSegment(departmentName, "Dept")}/${item}/${serial}/${fy}`;
}

/**
 * Recomputes and writes FixedAssetRecord.FAItemCode for one asset. Must run
 * inside the same transaction as whatever custody change triggered it
 * (assignment create/edit/delete, transfer create/edit/delete), so the code
 * update always lands — or rolls back — together with that change.
 *
 * Assets not sourced from a Tag (no SourceTagId, e.g. a hand-entered Fixed
 * Asset Record) are left untouched — there is no immutable base to rebuild
 * from safely.
 */
async function rebuildFAItemCode(tx, assetId) {
  const row = (await tx.request().input("AssetId", sql.Int, assetId).query(`
    SELECT fa.SourceTagId, t.FAItemCode AS BaseCode, dm.DepartmentName
    FROM dbo.FixedAssetRecord fa
    LEFT JOIN dbo.FixedAssetTagging t ON t.TagId = fa.SourceTagId
    LEFT JOIN dbo.users u ON u.id = fa.CustodianUserId
    LEFT JOIN dbo.DepartmentMaster dm ON dm.Id = u.DepartmentId
    WHERE fa.AssetId = @AssetId
  `)).recordset[0];
  if (!row || !row.SourceTagId || !row.BaseCode) return;

  const newCode = buildCurrentCode(row.BaseCode, row.DepartmentName);
  if (!newCode) return;

  await tx.request()
    .input("AssetId", sql.Int, assetId)
    .input("Code", sql.NVarChar(400), newCode)
    .query(`UPDATE dbo.FixedAssetRecord SET FAItemCode = @Code WHERE AssetId = @AssetId`);
}

module.exports = { rebuildFAItemCode, buildCurrentCode, shortFinYear };
