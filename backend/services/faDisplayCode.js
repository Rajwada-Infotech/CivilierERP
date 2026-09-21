/**
 * backend/services/faDisplayCode.js
 *
 * The FA Item Code saved on a record ("D2/Mobile/0011/FY 2026-27") is the
 * asset's permanent key and never changes. Once an asset has a custodian,
 * screens show it with that custodian's department inserted after the
 * project alias ("D2/Legal/Mobile/0011/FY 2026-27"), and the department
 * follows the asset when it is transferred to someone else.
 */
"use strict";

const { sql } = require("../db");

const CHUNK = 500;

function insertDepartment(code, departmentName) {
  if (!code || !departmentName) return code;
  const parts = String(code).split("/");
  // Not the Alias/ItemName/0001/FinYear shape — leave hand-typed codes alone.
  if (parts.length < 4) return code;
  const dept = String(departmentName).replace(/\//g, "-").trim();
  if (!dept) return code;
  return [parts[0], dept, ...parts.slice(1)].join("/");
}

async function departmentByCode(pool, codes) {
  const map = new Map();
  for (let i = 0; i < codes.length; i += CHUNK) {
    const slice = codes.slice(i, i + CHUNK);
    const request = pool.request();
    slice.forEach((c, j) => request.input(`c${j}`, sql.NVarChar(400), c));
    const result = await request.query(`
      SELECT fa.FAItemCode, dm.DepartmentName
      FROM dbo.FixedAssetRecord fa
      JOIN dbo.users u ON u.id = fa.CustodianUserId
      JOIN dbo.DepartmentMaster dm ON dm.Id = u.DepartmentId
      WHERE fa.Status <> 'Deleted'
        AND fa.FAItemCode IN (${slice.map((_, j) => `@c${j}`).join(",")})
    `);
    for (const r of result.recordset) map.set(r.FAItemCode, r.DepartmentName);
  }
  return map;
}

/**
 * Adds `FAItemCodeDisplay` (or `displayKey`) to a row or an array of rows.
 * Mutates and returns the same value. A failure here must never break the
 * screen that called it, so it falls back to leaving the plain code.
 */
async function annotateFACodeDisplay(pool, data, { codeKey = "FAItemCode", displayKey = "FAItemCodeDisplay" } = {}) {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const codes = [...new Set(rows.map((r) => r && r[codeKey]).filter(Boolean))];
  if (!codes.length) return data;
  let deptByCode = new Map();
  try {
    deptByCode = await departmentByCode(pool, codes);
  } catch (err) {
    console.error("[faDisplayCode] department lookup failed:", err.message);
  }
  for (const r of rows) {
    if (r && r[codeKey]) r[displayKey] = insertDepartment(r[codeKey], deptByCode.get(r[codeKey]));
  }
  return data;
}

async function displayCodeFor(pool, code) {
  if (!code) return code;
  const holder = { FAItemCode: code };
  await annotateFACodeDisplay(pool, holder);
  return holder.FAItemCodeDisplay;
}

module.exports = { insertDepartment, annotateFACodeDisplay, displayCodeFor };
