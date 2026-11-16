-- Migration 635: a party's own TDS limits. Vendors / contractors / brokers can have a higher (or lower) limit than the
-- standard ₹30,000 per bill / ₹1,00,000 per year. NULL = the standard limit (services/tds.js getTdsLimits), so every
-- existing party behaves exactly as before.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AccountHeadMaster' AND COLUMN_NAME = 'TdsSingleBillLimit')
  ALTER TABLE dbo.AccountHeadMaster ADD TdsSingleBillLimit DECIMAL(18,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AccountHeadMaster' AND COLUMN_NAME = 'TdsYearlyLimit')
  ALTER TABLE dbo.AccountHeadMaster ADD TdsYearlyLimit DECIMAL(18,2) NULL;
GO
