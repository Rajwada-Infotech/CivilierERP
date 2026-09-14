-- The Sales Automation -> CRM handoff (backend/services/saHandoff.js) was
-- writing into legacy dbo.FollowupApplications/FollowupBookings tables and
-- stamping SaLead.FollowupCustomerId/BookingId to point at THOSE rows —
-- meaning every lead promoted from the Sales Automation screen dead-ended
-- in a module the rest of the CRM pipeline (Agreement, Payments, Sale Deed,
-- Handover, Customer Portal...) never reads from. Fixed in code to write
-- dbo.CrmApplication/CrmBooking instead; these are the new linkage columns
-- for that (kept separate from the legacy FollowupCustomerId/BookingId
-- columns rather than repurposing them, to avoid semantic confusion for
-- anyone still reading those column names as "points at Followup*").
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'CrmApplicationId')
BEGIN
  ALTER TABLE dbo.SaLead ADD CrmApplicationId INT NULL REFERENCES dbo.CrmApplication(Id);
  PRINT 'Added SaLead.CrmApplicationId';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'CrmBookingId')
BEGIN
  ALTER TABLE dbo.SaLead ADD CrmBookingId INT NULL REFERENCES dbo.CrmBooking(Id);
  PRINT 'Added SaLead.CrmBookingId';
END
GO

-- Prevents the same lead being promoted into two different CrmApplication
-- rows by a race or a second click — a filtered unique index so multiple
-- CrmApplication rows with LeadId=NULL (created directly, not from a lead)
-- remain unaffected.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmApplication_LeadId' AND object_id = OBJECT_ID('dbo.CrmApplication'))
BEGIN
  CREATE UNIQUE INDEX UQ_CrmApplication_LeadId ON dbo.CrmApplication(LeadId) WHERE LeadId IS NOT NULL;
  PRINT 'Added UQ_CrmApplication_LeadId filtered unique index';
END
GO
