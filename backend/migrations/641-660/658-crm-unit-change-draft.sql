-- Migration 658: a unit change starts as a Draft. The Change Unit card picks the new unit and the reason; the buyer's
-- application for that unit then opens in the normal application wizard (rate, plan, parking, extra charges), and
-- submitting it sends the request (Pending) for its one approval. A Draft is open: one open request per booking.
-- Safe to run again.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmPropertyChangeRequest_OpenSource' AND object_id = OBJECT_ID('dbo.CrmPropertyChangeRequest'))
  DROP INDEX UX_CrmPropertyChangeRequest_OpenSource ON dbo.CrmPropertyChangeRequest;
GO
CREATE UNIQUE INDEX UX_CrmPropertyChangeRequest_OpenSource ON dbo.CrmPropertyChangeRequest(SourceBookingId)
  WHERE Status IN (N'Draft', N'Pending', N'Approved', N'MovingMoney', N'Failed');
GO
-- A short-lived earlier draft of this change (never released) added a price adjustment; a different price is now a
-- re-entered rate on the application, as for any sale.
IF COL_LENGTH('dbo.CrmPropertyChangeRequest', 'AdjustType') IS NOT NULL ALTER TABLE dbo.CrmPropertyChangeRequest DROP COLUMN AdjustType;
GO
IF COL_LENGTH('dbo.CrmPropertyChangeRequest', 'AdjustValue') IS NOT NULL ALTER TABLE dbo.CrmPropertyChangeRequest DROP COLUMN AdjustValue;
GO
IF COL_LENGTH('dbo.CrmPropertyChangeRequest', 'UnitValue') IS NOT NULL ALTER TABLE dbo.CrmPropertyChangeRequest DROP COLUMN UnitValue;
GO
PRINT 'Migration 658 complete: unit change draft';
