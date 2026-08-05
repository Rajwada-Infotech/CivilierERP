-- Booking invoices are auto-only (one per booking, system-generated) and
-- Milestone invoices are pinned to a MilestoneId with a unique index
-- (migration 268) — neither can ever be duplicated. Maintenance/Other
-- invoices had no equivalent guard: they're freeform (no MilestoneId to
-- anchor on), so staff could raise the same charge twice with nothing
-- stopping them.
--
-- BillingPeriod is a persisted computed column (YEAR/MONTH are deterministic,
-- so this is safe to persist) giving each invoice a stable "yyyy-MM" bucket
-- from its own InvoiceDate. A unique index on (BookingId, InvoiceType,
-- BillingPeriod), scoped to Maintenance/Other, then guarantees at the
-- database level — not just in application code — that a booking can never
-- carry two Maintenance (or two Other) invoices in the same calendar month.
-- This is enforced with no cancellation exception, matching how the
-- Milestone unique index (268) already behaves: every invoice row must be
-- unique, full stop.
--
-- Renumber this file if 269/270 collide with migrations landed elsewhere —
-- generated without visibility into the full migrations folder.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'BillingPeriod')
  ALTER TABLE dbo.CrmInvoice
    ADD BillingPeriod AS (
      CAST(YEAR(InvoiceDate) AS VARCHAR(4)) + '-' + RIGHT('0' + CAST(MONTH(InvoiceDate) AS VARCHAR(2)), 2)
    ) PERSISTED;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_MaintOther_Period')
  CREATE UNIQUE INDEX UQ_CrmInvoice_MaintOther_Period
    ON dbo.CrmInvoice(BookingId, InvoiceType, BillingPeriod)
    WHERE InvoiceType IN ('Maintenance', 'Other');
GO