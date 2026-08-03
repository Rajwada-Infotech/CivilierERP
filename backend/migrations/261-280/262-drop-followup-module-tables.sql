-- Migration 262: drop the retired Follow-Up module's tables.
--
-- The Follow-Up module's frontend pages, backend routes, and
-- backend/escalationEngine.js were removed in this same change — all of it
-- was 0-live-row, superseded by the actively-developed CRM module (see
-- crmApplications.js, crmBookings.js, crmAgreements.js, crmLegalMilestones.js,
-- crmSlaEngine.js, etc.). The 7 shared master-data pages (Unit/Room/Block/
-- Parking/ParkingSlot/PaymentPlan/ExtraCharge Master) and the Reminders /
-- Pending Tasks pages were NOT Follow-Up-exclusive — they moved to
-- src/pages/admin/masters/ and are still reachable from CRM's own
-- /crm/setup/* routes; their backing tables (UnitMaster, RoomMaster,
-- BlockMaster, ParkingMaster, ParkingSlot, PaymentPlan, ExtraCharge,
-- Tasks, TenantReminders) are untouched here.
--
-- dbo.BookingPaymentTerms has a legacy FK to FollowupBookings
-- (FK__BookingPa__Booki__039170F0) but BookingPaymentTerms itself is not
-- Follow-Up-exclusive (still referenced by CRM demand-tracking migrations)
-- and is kept — only the FK constraint pointing at FollowupBookings is
-- dropped so FollowupBookings can be dropped cleanly.
IF EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK__BookingPa__Booki__039170F0'
)
BEGIN
  ALTER TABLE dbo.BookingPaymentTerms DROP CONSTRAINT [FK__BookingPa__Booki__039170F0];
END

-- Drop in FK-dependency order (children before parents).
DROP TABLE IF EXISTS dbo.FollowupAgreementWorkflows;
DROP TABLE IF EXISTS dbo.FollowupLegalMilestones;
DROP TABLE IF EXISTS dbo.FollowupPaymentReceipts;
DROP TABLE IF EXISTS dbo.FollowupNOCs;
DROP TABLE IF EXISTS dbo.FollowupConstructionUpdates;
DROP TABLE IF EXISTS dbo.FollowupDocumentVault;
DROP TABLE IF EXISTS dbo.FollowupHandovers;
DROP TABLE IF EXISTS dbo.FollowupPossessionNotices;
DROP TABLE IF EXISTS dbo.FollowupPrePossession;
DROP TABLE IF EXISTS dbo.FollowupSalesDeeds;
DROP TABLE IF EXISTS dbo.FollowupAgreements;
DROP TABLE IF EXISTS dbo.FollowupApplications;
DROP TABLE IF EXISTS dbo.FollowupBookings;
DROP TABLE IF EXISTS dbo.FollowupUnitSelections;
DROP TABLE IF EXISTS dbo.FollowupApplicants;
DROP TABLE IF EXISTS dbo.FollowupWelcomeCalls;
DROP TABLE IF EXISTS dbo.FollowupAuditLog;
DROP TABLE IF EXISTS dbo.FollowupCommunicatorLog;
DROP TABLE IF EXISTS dbo.FollowupLog;
