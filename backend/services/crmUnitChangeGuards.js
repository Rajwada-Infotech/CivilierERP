const { getPool, sql } = require("../db");
const { PROPERTY_CHANGE_CLOSED_SQL, UnitChangeStatus } = require("../constants/crmStatuses");

/**
 * A unit-change application stays in Draft until its approved move creates a booking. Its own request
 * is the authoritative submission state, so every application-side writer must consult this guard.
 */
async function unitChangeApplicationEditBlock(pool = getPool(), applicationId) {
  const row = (await pool.request().input("aid", sql.Int, Number(applicationId)).query(`
    SELECT TOP 1 RequestNo, Status
    FROM dbo.CrmPropertyChangeRequest
    WHERE TargetApplicationId = @aid
      AND Status NOT IN ${PROPERTY_CHANGE_CLOSED_SQL}
      AND Status <> N'${UnitChangeStatus.DRAFT}'
    ORDER BY Id DESC
  `)).recordset[0];
  if (!row) return null;
  return `Unit change ${row.RequestNo} is ${row.Status}; its application is locked until the request is withdrawn, rejected, or completed.`;
}

async function assertUnitChangeApplicationEditable(pool, applicationId) {
  const message = await unitChangeApplicationEditBlock(pool, applicationId);
  if (message) throw Object.assign(new Error(message), { status: 409 });
}

module.exports = { unitChangeApplicationEditBlock, assertUnitChangeApplicationEditable };
