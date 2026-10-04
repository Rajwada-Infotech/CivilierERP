const { sql } = require("../db");

let sundryCreditorsGroupId;

function cleanText(value, max) {
  const text = String(value || "").trim();
  if (!text) return null;
  return max ? text.slice(0, max) : text;
}

async function getSundryCreditorsGroupId(pool) {
  if (sundryCreditorsGroupId !== undefined) return sundryCreditorsGroupId;
  const result = await pool.request()
    .query("SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SCS'");
  sundryCreditorsGroupId = result.recordset[0]?.AGId ?? null;
  return sundryCreditorsGroupId;
}

async function ensureBrokerForChannelPartner(pool, channelPartnerId, actorUserId = null) {
  if (!channelPartnerId) return null;

  const partnerResult = await pool.request()
    .input("id", sql.Int, channelPartnerId)
    .query(`
      SELECT Id, PartnerCode, Name, Mobile, Email, FirmName, Region,
             CommissionRate, CrmBrokerLHeadId
      FROM dbo.SaChannelPartner
      WHERE Id = @id AND IsActive = 1
    `);
  const partner = partnerResult.recordset[0];
  if (!partner) return null;

  if (partner.CrmBrokerLHeadId) {
    const linked = await pool.request()
      .input("id", sql.Int, partner.CrmBrokerLHeadId)
      .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadId = @id AND LHeadType = 'BR'");
    if (linked.recordset.length) {
      return { brokerId: partner.CrmBrokerLHeadId, commissionRate: partner.CommissionRate };
    }
  }

  const phone = cleanText(partner.Mobile, 15);
  const email = cleanText(partner.Email, 100)?.toLowerCase() || null;
  const groupId = await getSundryCreditorsGroupId(pool);

  // AccountHeadMaster has no unique constraint on LHeadCode/phone/email for
  // type 'BR', so without a lock two near-simultaneous callers (e.g. two
  // staff submitting an Application/Booking for the same still-unlinked
  // ChannelPartnerId within the same second) can both pass the "does a
  // broker head already exist" check and both INSERT one — an orphaned
  // duplicate ledger head that never gets linked back (only the last
  // UPDATE wins) and silently swallows any commission postings made
  // against it. Same UPDLOCK-inside-a-transaction pattern already used for
  // Unit booking (crmEntityCreation.js) and Parking slots (crmParking.js).
  const tx = pool.transaction();
  await tx.begin();
  let brokerId;
  try {
    const existing = await tx.request()
      .input("code", sql.NVarChar(20), `SACP-${partner.Id}`)
      .input("phone", sql.VarChar(15), phone)
      .input("email", sql.NVarChar(100), email)
      .query(`
        SELECT TOP 1 LHeadId
        FROM dbo.AccountHeadMaster WITH (UPDLOCK, HOLDLOCK)
        WHERE LHeadType = 'BR'
          AND (
            LHeadCode = @code
            OR (@phone IS NOT NULL AND LHeadPhone = @phone)
            OR (@email IS NOT NULL AND LOWER(LTRIM(RTRIM(LHeadEmail))) = @email)
          )
        ORDER BY CASE WHEN LHeadCode = @code THEN 0 ELSE 1 END, LHeadId
      `);

    brokerId = existing.recordset[0]?.LHeadId || null;
    if (!brokerId) {
      const inserted = await tx.request()
        .input("name", sql.NVarChar(200), cleanText(partner.Name, 200) || "Channel Partner")
        .input("code", sql.NVarChar(20), `SACP-${partner.Id}`)
        .input("phone", sql.VarChar(15), phone)
        .input("email", sql.NVarChar(100), email)
        .input("address", sql.VarChar(300), cleanText(partner.Region, 300) || "N/A")
        .input("contact", sql.VarChar(100), cleanText(partner.FirmName, 100) || cleanText(partner.Name, 100) || "N/A")
        .input("groupId", sql.Int, groupId)
        .input("desc", sql.NVarChar(sql.MAX), `Auto-created from Sales Automation channel partner ${partner.PartnerCode || partner.Id}`)
        .input("createdBy", sql.NVarChar(100), actorUserId ? String(actorUserId) : "sa-channel-partner")
        .query(`
          INSERT INTO dbo.AccountHeadMaster
            (LHeadName, LHeadCode, LHeadType, LHeadPhone, LHeadEmail,
             LHeadAddress, LHeadContactPerson, LHeadStatus, LHeadPaymentTerms,
             LCountry, LBelongsTo, LDescription, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.LHeadId
          VALUES
            (@name, @code, 'BR', @phone, @email,
             @address, @contact, 1, 'N/A',
             'India', @groupId, @desc, 'Approved', @createdBy, SYSDATETIME())
        `);
      brokerId = inserted.recordset[0].LHeadId;
    }

    await tx.request()
      .input("cpid", sql.Int, partner.Id)
      .input("brokerId", sql.Int, brokerId)
      .input("actor", sql.Int, actorUserId)
      .query(`
        UPDATE dbo.SaChannelPartner
        SET CrmBrokerLHeadId = @brokerId,
            UpdatedBy = COALESCE(@actor, UpdatedBy),
            UpdatedAt = SYSDATETIME()
        WHERE Id = @cpid
      `);

    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
    throw txErr;
  }

  return { brokerId, commissionRate: partner.CommissionRate };
}

module.exports = {
  ensureBrokerForChannelPartner,
};
