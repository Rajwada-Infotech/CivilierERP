// CRM Leads: the pool of leads marked Converted in Sales Automation, each with the CRM customer made from it (if any).
// Read-only, under the CRM Leads or Customers right. The page used to read /api/sa/leads (Sales Automation's right) and
// /api/crm/customers (project-scoped, so a customer with no application yet was missing); a CRM user without the first
// saw an empty pool, and one limited to some projects saw used leads as still available.
const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requireAnyPageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(apiRateLimit);

// Also read by Customers' New Customer form (to offer only leads no active customer carries yet) and by Applications
// (to carry the lead's source chain onto a new application).
router.get("/", requireAnyPageRight(["crm-leads", "crm-customers", "crm-applications"], "view"), async (_req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT
        l.Id, l.LeadUid, l.CustomerName, l.Mobile, l.AltMobile, l.Email, l.DateGenerated, l.SourceType,
        l.PlatformId, l.CampaignId, l.AdId, l.ChannelPartnerId,
        l.PropertyType, l.BhkPreference, l.PreferredLocation, l.BudgetMin, l.BudgetMax,
        sp.name AS SalespersonName,
        -- "Used" means an active customer carries the lead: the same rule Create Customer refuses on.
        c.Id AS CustomerId, c.CustomerNo, c.CreatedAt AS CustomerCreatedAt
      FROM dbo.SaLead l
      LEFT JOIN dbo.Users sp ON sp.id = l.AssignedSalespersonId
      OUTER APPLY (
        SELECT TOP 1 cc.Id, cc.CustomerNo, cc.CreatedAt FROM dbo.CrmCustomer cc
        WHERE cc.LeadId = l.Id AND cc.IsActive = 1 ORDER BY cc.Id
      ) c
      WHERE l.IsActive = 1 AND l.Status = N'Converted'
      ORDER BY l.DateGenerated DESC, l.Id DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-leads] GET error:", e.message);
    res.status(500).json({ error: "Could not load the leads." });
  }
});

module.exports = router;
