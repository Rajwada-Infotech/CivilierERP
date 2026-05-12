-- Migration 043: Fix /api/enterprises slow query (1534ms → <10ms)
--
-- Root causes identified:
--
--   1. Migration 042 included `logo` (NVARCHAR(MAX)) in the INCLUDE list of
--      IX_enterprise_E_covering. SQL Server CANNOT store MAX-type columns in
--      index pages — the CREATE INDEX either failed silently or was rejected,
--      leaving the table with no usable index for the GET /api/enterprises query,
--      causing a full heap scan on every request (observed: 1534ms).
--
--   2. The GET /api/enterprises route was SELECTing `logo` (a NVARCHAR(MAX)
--      base64 string, typically 50-200 KB per row) for the list view. Reading
--      LOB data requires separate out-of-row page reads — O(N) blob fetches
--      even with a covering index. This has been fixed in enterprise.js (logo
--      is now only fetched by GET /by-id/:id used by the edit form).
--
--   3. `authorized_capital` and `paid_up_capital` were SELECTed but never
--      added to the schema — removed from the route query.
--
-- This migration:
--   a) Drops the broken indexes from 040 and 042 (if they exist).
--   b) Creates one correct covering index for the list query that:
--      - Has no MAX-type columns (logo excluded — no longer in list SELECT).
--      - Covers every column the fixed GET / query actually reads.
--      - Uses (business_type, discontinue, name) as the key so the
--        WHERE + ORDER BY is satisfied from the index without a sort.
-- Safe to re-run — all statements are guarded.

-- ── Drop previous broken indexes ─────────────────────────────────────────────
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_type_active'
)
  DROP INDEX IX_enterprise_type_active ON dbo.enterprise;
GO

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise') AND name = N'IX_enterprise_E_covering'
)
  DROP INDEX IX_enterprise_E_covering ON dbo.enterprise;
GO

-- ── Covering index for GET /api/enterprises list ──────────────────────────────
-- Query: WHERE business_type = 'E' AND discontinue = 0  ORDER BY name
-- Selects (after fix — logo removed from list query):
--   id, name, short_name, business_identity, entity_type,
--   b_sub_identity_type, belongs_to,
--   address, address_line2, city, state, country, pincode,
--   phone_number, email, website,
--   pan, tan, cin, gst_type, gst_issue_date, trade_license,
--   currency, fiscal_year_start, start_date, date_of_entry, discontinue
--
-- Key: (business_type, discontinue, name) → satisfies WHERE clause + ORDER BY
--   in one index seek, zero sort step.
-- Include: all remaining columns → zero heap/LOB lookups.
-- NOTE: logo is intentionally excluded (NVARCHAR(MAX) cannot be in an index;
--   it is now fetched only by GET /by-id/:id on the detail/edit path).
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.enterprise')
    AND name = N'IX_enterprise_list_covering'
)
  CREATE NONCLUSTERED INDEX IX_enterprise_list_covering
    ON dbo.enterprise (business_type, discontinue, name)
    INCLUDE (
      id, short_name, business_identity, entity_type,
      b_sub_identity_type, belongs_to,
      address, address_line2, city, state, country, pincode,
      phone_number, email, website,
      pan, tan, cin, gst_type, gst_issue_date, trade_license,
      currency, fiscal_year_start, start_date, date_of_entry
    );
GO

-- ── Update statistics to ensure the new index is immediately chosen ───────────
UPDATE STATISTICS dbo.enterprise;
GO

PRINT '043-enterprise-list-index applied.';
PRINT 'Expected: GET /api/enterprises drops from ~1500ms to <10ms.';
GO
