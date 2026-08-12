-- 307-tds-limit-toggle.sql
--
-- Per-supplier/contractor toggle controlling whether the ₹30k single-bill /
-- ₹1L yearly-cumulative threshold (spec Section 13) gates TDS deduction at
-- all, on top of the existing IsTdsApplicable eligibility flag (migration
-- 155):
--   TdsLimitApplicable = 1 (default) — TDS deducts only once the threshold
--     is crossed, exactly as built in migration 304.
--   TdsLimitApplicable = 0 — TDS Applicable deducts on every eligible bill
--     unconditionally; the threshold check is bypassed entirely.
--
-- Defaults to 1 so every existing Supplier/Contractor keeps the exact
-- behaviour they already had (threshold logic on) until someone explicitly
-- turns it off.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'AccountHeadMaster' AND COLUMN_NAME = 'TdsLimitApplicable'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster
    ADD TdsLimitApplicable BIT NOT NULL DEFAULT 1;
END
