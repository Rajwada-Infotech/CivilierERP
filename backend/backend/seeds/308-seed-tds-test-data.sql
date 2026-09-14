-- Migration 308: seed TDS Master with standard sections + flag a handful of
-- existing suppliers/contractors as TDS-applicable (some threshold-gated,
-- some not) so the TDS posting/calculation flow can be tested end-to-end.

-- ── TDS Master ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194C' AND Percentage = 1)
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194C', 'Contractor Payment (Individual/HUF)', 1.00, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194C' AND Percentage = 2)
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194C', 'Contractor Payment (Others)', 2.00, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194J')
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194J', 'Professional / Technical Services', 10.00, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194I' AND Name LIKE 'Rent (Plant%')
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194I', 'Rent (Plant & Machinery)', 2.00, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194I' AND Name LIKE 'Rent (Land%')
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194I', 'Rent (Land/Building/Furniture)', 10.00, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194H')
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194H', 'Commission / Brokerage', 5.00, 1, GETDATE());

-- One inactive record on purpose — lets you verify the invoice TDS dropdown
-- correctly excludes it (only tdsRecords.filter(t => t.status) show up).
IF NOT EXISTS (SELECT 1 FROM dbo.TDSMaster WHERE Nature = '194Q')
  INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
  VALUES ('194Q', 'Purchase of Goods (discontinued rate)', 0.10, 0, GETDATE());

-- ── Flag test suppliers/contractors as TDS-applicable ──────────────────────
-- Contractors — normal threshold-gated behaviour (TdsLimitApplicable stays
-- at its existing default of 1/true): the ₹30k single-bill / ₹1L yearly
-- threshold must be crossed before TDS actually deducts.
UPDATE dbo.AccountHeadMaster
SET IsTdsApplicable = 1
WHERE LHeadId IN (32, 35, 46) AND LHeadType = 'C'; -- Buildmax Civil, Bright Spark Electrical, Titas Construction

-- One contractor with the threshold check turned OFF — TDS deducts on
-- every eligible bill unconditionally, regardless of amount. Exercises the
-- TdsLimitApplicable=0 branch in resolveThresholdStatus (services/tds.js).
UPDATE dbo.AccountHeadMaster
SET IsTdsApplicable = 1, TdsLimitApplicable = 0
WHERE LHeadId = 44 AND LHeadType = 'C'; -- Bengal Labour Supply Agency

-- Suppliers — TDS also applies to some goods suppliers (194Q-style), kept
-- threshold-gated.
UPDATE dbo.AccountHeadMaster
SET IsTdsApplicable = 1
WHERE LHeadId IN (74, 75, 143) AND LHeadType = 'S'; -- Demo Steel, Demo Cement, Saha Enterprise

PRINT '308-seed-tds-test-data applied successfully.';
GO
