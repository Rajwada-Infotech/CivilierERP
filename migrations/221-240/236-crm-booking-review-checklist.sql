-- A Booking used to be auto-approved by the system in the same request that
-- approved its Application (crmApplications.js), meaning "Approved" never
-- reflected a real human decision. Now that the auto-approve is removed,
-- Approve requires two explicit staff confirmations first — these columns
-- back that checklist (mirrors the Welcome Call page's own checklist
-- pattern, just for the Booking stage instead).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitReviewConfirmed')
  ALTER TABLE dbo.CrmBooking ADD UnitReviewConfirmed BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitReviewConfirmedBy')
  ALTER TABLE dbo.CrmBooking ADD UnitReviewConfirmedBy INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitReviewConfirmedAt')
  ALTER TABLE dbo.CrmBooking ADD UnitReviewConfirmedAt DATETIME2(3) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'PlanReviewConfirmed')
  ALTER TABLE dbo.CrmBooking ADD PlanReviewConfirmed BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'PlanReviewConfirmedBy')
  ALTER TABLE dbo.CrmBooking ADD PlanReviewConfirmedBy INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'PlanReviewConfirmedAt')
  ALTER TABLE dbo.CrmBooking ADD PlanReviewConfirmedAt DATETIME2(3) NULL;
GO
