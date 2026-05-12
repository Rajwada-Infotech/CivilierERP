-- Migration 040b: Fix incomplete covering indexes on dbo.enterprise
-- 
-- Root cause of persistent 1.5-2.3 s query times on /api/enterprises and
-- /api/company-master AFTER migration 040 was applied:
--
--   Migration 040 created IX_enterprise_type_active with an INCLUDE list that
--   was missing most columns both routes actually SELECT. SQL Server performed
--   an index seek on (business_type, discontinue) to find matching rows, then
--   issued a KEY LOOKUP back to the heap for every row to fetch the missing
--   columns — effectively a full table scan with extra overhead.
--
-- This migration drops the incomplete index and creates two purpose-built
-- covering indexes, one per route, so both queries are fully satisfied from
-- the index leaf pages with zero heap lookups.
--
-- Safe to re-run — all statements are guarded.

-- ── Drop the incomplete shared index from 040 ────────────────────────────────
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise')
    AND name = N'IX_enterprise_type_active'
)
  DROP INDEX IX_enterprise_type_active ON dbo.enterprise;
GO

-- ── 1. Covering index for GET /api/enterprises ───────────────────────────────
-- Query:  WHERE business_type = 'E' AND discontinue = 0  ORDER BY name
-- Selects: id, name, short_name, business_identity, entity_type,
--          b_sub_identity_type, belongs_to,
--          address, address_line2, city, state, country, pincode,
--          phone_number, email, website, logo,
--          pan, tan, cin, gst_type, gst_issue_date, trade_license,
--          currency, fiscal_year_start,
--          authorized_capital, paid_up_capital,
--          start_date, date_of_entry, discontinue
--
-- Key:     (business_type, discontinue, name) — satisfies WHERE + ORDER BY
-- Include: every remaining SELECT column — zero heap lookups
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise')
    AND name = N'IX_enterprise_E_covering'
)
  CREATE NONCLUSTERED INDEX IX_enterprise_E_covering
    ON dbo.enterprise (business_type, discontinue, name)
    INCLUDE (
      id, short_name, business_identity, entity_type,
      b_sub_identity_type, belongs_to,
      address, address_line2, city, state, country, pincode,
      phone_number, email, website, logo,
      pan, tan, cin, gst_type, gst_issue_date, trade_license,
      currency, fiscal_year_start,
      authorized_capital, paid_up_capital,
      start_date, date_of_entry
    );
GO

-- ── 2. Covering index for GET /api/company-master ────────────────────────────
-- Query:  WHERE business_type = 'C'  ORDER BY name
-- Selects: id, business_identity, name, description, short_name,
--          entity_type, cr_code, date_of_establishment,
--          cin, pan, tan, gst_type, b_sub_identity_type, gst_issue_date,
--          trade_license, rera_date,
--          address, address_line2, city, state, country, pincode,
--          phone_number, fax, email, website,
--          authorized_capital, paid_up_capital, currency, fiscal_year_start,
--          auditor_name, discontinue, remarks, logo, status, belongs_to
--
-- Key:     (business_type, name) — satisfies WHERE + ORDER BY
-- Include: every remaining SELECT column — zero heap lookups
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise')
    AND name = N'IX_enterprise_C_covering'
)
  CREATE NONCLUSTERED INDEX IX_enterprise_C_covering
    ON dbo.enterprise (business_type, name)
    INCLUDE (
      id, business_identity, description, short_name,
      entity_type, cr_code, date_of_establishment,
      cin, pan, tan, gst_type, b_sub_identity_type, gst_issue_date,
      trade_license, rera_date,
      address, address_line2, city, state, country, pincode,
      phone_number, fax, email, website,
      authorized_capital, paid_up_capital, currency, fiscal_year_start,
      auditor_name, discontinue, remarks, logo, status, belongs_to
    );
GO

PRINT 'Migration 040b applied — enterprise covering indexes rebuilt.';
PRINT 'Both /api/enterprises and /api/company-master queries now run index-only.';
GO
