const { sql } = require("../db");

async function findCrmBrokerageConflict(pool, bookingId) {
  if (!bookingId) return null;
  const result = await pool.request()
    .input("bid", sql.Int, bookingId)
    .query(`
      SELECT TOP 1 Id, BrokerName, Status
      FROM dbo.CrmBrokerageMaster
      WHERE BookingId = @bid
      ORDER BY CreatedAt DESC, Id DESC
    `);
  return result.recordset[0] || null;
}

async function assertNoChannelPartnerBrokerageConflict(pool, bookingId, channelPartnerId, cpAmount) {
  const hasChannelPartnerPayout = !!channelPartnerId || Number(cpAmount || 0) > 0;
  if (!hasChannelPartnerPayout) return;

  const conflict = await findCrmBrokerageConflict(pool, bookingId);
  if (!conflict) return;

  const broker = conflict.BrokerName ? ` for broker ${conflict.BrokerName}` : "";
  const error = new Error(`CRM brokerage already exists for this booking${broker}; use the CRM brokerage Finance-payment flow instead of SA channel-partner commission.`);
  error.statusCode = 409;
  error.conflict = {
    crmBrokerageId: conflict.Id,
    brokerName: conflict.BrokerName || null,
    status: conflict.Status || null,
  };
  throw error;
}

module.exports = {
  findCrmBrokerageConflict,
  assertNoChannelPartnerBrokerageConflict,
};
