-- Part 1: persist the milestone's own Percent (of the booking's GrandTotal)
-- alongside its already-existing AmountDue. generateMilestonesForBooking has
-- always known each milestone's percent at creation time but discarded it
-- after computing AmountDue — meaning the UI could only ever show ₹, never
-- the % a customer's payment plan actually promised, and there was no
-- stored weight to redistribute against when a milestone gets manually
-- overridden or the booking's total changes.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'Percent')
  ALTER TABLE dbo.CrmPaymentMilestone ADD [Percent] DECIMAL(5,2) NULL;
GO

-- Part 2: full demand lifecycle, mirroring the Followup module's
-- BookingPaymentTerms model (DemandStatus/DemandNo/DemandRaisedOn/
-- DemandNotes) so the CRM-native equivalent isn't a bare, statusless
-- timestamp. DemandRaisedAt (added in 152-crm-full-fledged-parity.sql)
-- stays as-is for backward compatibility with anything still reading it;
-- DemandRaisedOn is the new DATE-typed field the richer lifecycle uses.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DemandStatus')
  ALTER TABLE dbo.CrmPaymentMilestone ADD DemandStatus NVARCHAR(20) NOT NULL DEFAULT 'Pending';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DemandNo')
  ALTER TABLE dbo.CrmPaymentMilestone ADD DemandNo NVARCHAR(60) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DemandRaisedOn')
  ALTER TABLE dbo.CrmPaymentMilestone ADD DemandRaisedOn DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DemandNotes')
  ALTER TABLE dbo.CrmPaymentMilestone ADD DemandNotes NVARCHAR(500) NULL;
GO

-- Backfill: any milestone that already had a demand raised the old
-- (statusless) way should read as 'Demanded', not silently revert to
-- 'Pending' under the new model.
UPDATE dbo.CrmPaymentMilestone
SET DemandStatus = 'Demanded', DemandRaisedOn = CAST(DemandRaisedAt AS DATE)
WHERE DemandRaisedAt IS NOT NULL AND DemandStatus = 'Pending';
GO
