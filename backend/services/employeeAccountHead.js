/**
 * backend/services/employeeAccountHead.js
 *
 * Every Employee Master record owns exactly one Account Head Master row
 * (LHeadType = 'E'), linked through EmployeeMaster.AccountHeadId. All three
 * helpers take the caller's open transaction so the employee row and its
 * head are always created, changed and removed together -- a failure in
 * either rolls back both, so neither can be left orphaned.
 */
"use strict";

const { sql } = require("../db");

const HEAD_TYPE = "E";

const headCode = (employeeId) => `EMPAH-${employeeId}`;

function bindHead(request, emp) {
  return request
    .input("Name", sql.VarChar(200), String(emp.name || "").trim().slice(0, 200))
    .input("Phone", sql.NVarChar(40), emp.phone ? String(emp.phone).slice(0, 40) : null)
    .input("Email", sql.NVarChar(400), emp.email ? String(emp.email).slice(0, 400) : null)
    .input("Address", sql.NVarChar(600), (emp.address && String(emp.address).trim()) ? String(emp.address).slice(0, 600) : "N/A")
    .input("Active", sql.Bit, emp.isActive === false ? 0 : 1);
}

/** Creates the head and links it. Returns the new LHeadId. */
async function createEmployeeAccountHead(tx, employeeId, emp, createdBy) {
  const ins = await bindHead(tx.request(), emp)
    .input("Code", sql.NVarChar(40), headCode(employeeId))
    .input("Type", sql.VarChar(50), HEAD_TYPE)
    .input("CreatedBy", sql.NVarChar(200), createdBy || null)
    .query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadType, LHeadAddress, LHeadContactPerson, LHeadPhone, LHeadEmail,
         LHeadStatus, Status, CreatedBy, CreatedAt, ApprovedBy, ApprovedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@Name, @Code, @Type, @Address, N'N/A', @Phone, @Email,
         @Active, N'Approved', @CreatedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
    `);
  const headId = ins.recordset[0].LHeadId;
  await tx.request()
    .input("EmployeeId", sql.Int, employeeId)
    .input("HeadId", sql.Int, headId)
    .query(`UPDATE dbo.EmployeeMaster SET AccountHeadId = @HeadId WHERE EmployeeId = @EmployeeId`);
  return headId;
}

/** Keeps the head's name/contact/status in step with the employee. If the
 *  employee somehow has no head yet (legacy row), creates it. */
async function syncEmployeeAccountHead(tx, employeeId, emp, updatedBy) {
  const cur = await tx.request().input("EmployeeId", sql.Int, employeeId)
    .query(`SELECT AccountHeadId FROM dbo.EmployeeMaster WHERE EmployeeId = @EmployeeId`);
  const headId = cur.recordset[0]?.AccountHeadId;
  if (!headId) return createEmployeeAccountHead(tx, employeeId, emp, updatedBy);
  await bindHead(tx.request(), emp)
    .input("HeadId", sql.Int, headId)
    .input("UpdatedBy", sql.NVarChar(200), updatedBy || null)
    .query(`
      UPDATE dbo.AccountHeadMaster
      SET LHeadName = @Name, LHeadAddress = @Address, LHeadPhone = @Phone, LHeadEmail = @Email,
          LHeadStatus = @Active, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
      WHERE LHeadId = @HeadId AND LHeadType = 'E'
    `);
  return headId;
}

/** Hard-deletes the employee's head. Call AFTER the employee row itself is
 *  deleted (EmployeeMaster.AccountHeadId is a foreign key into the head).
 *  Throws the SQL foreign-key error if the head is already referenced by a
 *  ledger/payment -- the caller's transaction then rolls back the whole
 *  employee delete, so nothing is left half-removed. */
async function deleteAccountHeadById(tx, headId) {
  if (!headId) return;
  await tx.request().input("HeadId", sql.Int, headId)
    .query(`DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @HeadId AND LHeadType = 'E'`);
}

module.exports = { createEmployeeAccountHead, syncEmployeeAccountHead, deleteAccountHeadById, HEAD_TYPE };
