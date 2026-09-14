/**
 * Validates that Platform -> Campaign -> Ad selections are actually
 * consistent with each other (an Ad belongs to the given Campaign, which
 * belongs to the given Platform). Shared by every entity that captures a
 * marketing source chain — SaLead and CrmApplication — so the same rule
 * can't drift between them.
 */
const { sql } = require("../db");

async function validateSourceChain(pool, { PlatformId, CampaignId, AdId }) {
  if (AdId) {
    const ad = await pool.request()
      .input("AdId", sql.Int, parseInt(AdId, 10))
      .query(`
        SELECT a.Id, a.CampaignId, c.PlatformId
        FROM dbo.SaAd a
        JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
        WHERE a.Id = @AdId AND a.IsActive = 1
      `);
    if (!ad.recordset.length) return "Selected advertisement does not exist or is inactive";
    const row = ad.recordset[0];
    if (CampaignId && Number(CampaignId) !== Number(row.CampaignId)) {
      return "Selected advertisement does not belong to the selected campaign";
    }
    if (PlatformId && Number(PlatformId) !== Number(row.PlatformId)) {
      return "Selected advertisement does not belong to the selected platform";
    }
  }
  if (CampaignId && PlatformId) {
    const campaign = await pool.request()
      .input("CampaignId", sql.Int, parseInt(CampaignId, 10))
      .input("PlatformId", sql.Int, parseInt(PlatformId, 10))
      .query(`
        SELECT 1 AS ok
        FROM dbo.SaCampaign
        WHERE Id = @CampaignId AND PlatformId = @PlatformId AND IsActive = 1
      `);
    if (!campaign.recordset.length) {
      return "Selected campaign does not belong to the selected platform";
    }
  }
  return null;
}

module.exports = { validateSourceChain };
