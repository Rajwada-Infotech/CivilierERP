-- ============================================================
-- Migration 414: crm-money-receipt-indexes
-- Why: the money-receipt list, count, and sweep-pending queries all filter
-- or join on columns that (based on the query patterns in
-- crmMoneyReceipts.js / crmMoneyReceiptWorkflow.js) are not necessarily
-- indexed today. At low row counts this doesn't show up; at real customer
-- volume these become table scans.
-- Idempotent — every index is guarded by an existence check by (name,
-- table), so this is safe to re-run.
--
-- NOTE: placed as 414 to follow directly from 413-crm-booking-backfill-
-- project-id.sql, the highest migration number visible in your
-- migrations/381-400 folder — double check nothing else has since claimed
-- 414 before running (this is exactly the kind of numbering collision that
-- bit the 254/255 portal-rework migrations).
--
-- I haven't seen your actual current sys.indexes for these tables, so a
-- couple of these may already exist under a different name — the existence
-- check below is by (name, table), not by columns, so review before
-- running in prod if you keep a stricter naming convention.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_BookingId' AND object_id = OBJECT_ID('dbo.CrmMoneyReceipt')
)
  -- Every list/detail/count query joins CrmMoneyReceipt -> CrmBooking on
  -- BookingId, and the booking-scoped GET (no ?page) filters on it directly.
  CREATE INDEX IX_CrmMoneyReceipt_BookingId ON dbo.CrmMoneyReceipt (BookingId) INCLUDE (Status, ReceivedPaymentId, CreatedAt);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_Status_ReceivedPaymentId' AND object_id = OBJECT_ID('dbo.CrmMoneyReceipt')
)
  -- Matches sweep-pending's WHERE Status = 'Pending' AND ReceivedPaymentId IS NULL,
  -- and the ?status= filter on the main list.
  CREATE INDEX IX_CrmMoneyReceipt_Status_ReceivedPaymentId ON dbo.CrmMoneyReceipt (Status, ReceivedPaymentId);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_ReceivedPaymentId' AND object_id = OBJECT_ID('dbo.CrmMoneyReceipt')
)
  -- getMoneyReceiptByReceivedPaymentId (used on every approved-payment
  -- event) looks this up directly; also backs the ReceivedPayment LEFT JOIN.
  CREATE UNIQUE INDEX IX_CrmMoneyReceipt_ReceivedPaymentId ON dbo.CrmMoneyReceipt (ReceivedPaymentId) WHERE ReceivedPaymentId IS NOT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_CreatedAt' AND object_id = OBJECT_ID('dbo.CrmMoneyReceipt')
)
  -- Every list query orders by CreatedAt DESC; without this SQL Server sorts
  -- the whole filtered result set in memory/tempdb before paging it.
  CREATE INDEX IX_CrmMoneyReceipt_CreatedAt ON dbo.CrmMoneyReceipt (CreatedAt DESC);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmBooking_ApplicationId' AND object_id = OBJECT_ID('dbo.CrmBooking')
)
  -- Joined on for every receipt row (applicant name/mobile).
  CREATE INDEX IX_CrmBooking_ApplicationId ON dbo.CrmBooking (ApplicationId);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmBooking_ProjectId_CompanyId' AND object_id = OBJECT_ID('dbo.CrmBooking')
)
  -- Backs the ?companyId= / ?projectId= list filters.
  CREATE INDEX IX_CrmBooking_ProjectId_CompanyId ON dbo.CrmBooking (ProjectId, CompanyId);

-- ── Search ──────────────────────────────────────────────────────────────
-- The ApplicantName/Mobile/BookingNo/ReceiptNo search uses a leading-wildcard
-- LIKE '%...%', which cannot use a regular index no matter what you add here
-- — SQL Server has to scan. If/when the receipt table is large enough that
-- search becomes slow, the real fix is a full-text index, not a b-tree one:
--
--   CREATE FULLTEXT CATALOG CrmSearchCatalog AS DEFAULT;
--   CREATE FULLTEXT INDEX ON dbo.CrmMoneyReceipt(ReceiptNo)
--     KEY INDEX <name of the PK index on CrmMoneyReceipt.Id>;
--
-- Left out of this script since it needs the Full-Text Search feature
-- installed and a PK index name I don't have — flagging it here rather than
-- guessing at your setup.