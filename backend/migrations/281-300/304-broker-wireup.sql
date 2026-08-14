-- Run against Civilier DB. Companion to the CrmBooking/CrmBrokerageMaster
-- migration already applied — adds the same plan field to CrmApplication,
-- where it's actually captured by staff (see crmApplications.js PUT /:id),
-- then copied onto CrmBooking at booking-creation time.
--
-- BrokerageSplitEnabled is left in place on both tables (harmless, unused
-- going forward) rather than dropped, in case anything outside this
-- codebase's uploaded files still reads it — safe to drop later once
-- confirmed dead.

-- Same applied-by-hand-before-umzug situation as migration 303 — guarded
-- so this is a safe no-op here and a real apply anywhere still missing it.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'BrokeragePaymentPlan')
  ALTER TABLE dbo.CrmApplication
    ADD BrokeragePaymentPlan NVARCHAR(20) NOT NULL
      CONSTRAINT DF_CrmApplication_BrokeragePaymentPlan DEFAULT 'OneTime'
      CONSTRAINT CK_CrmApplication_BrokeragePaymentPlan
        CHECK (BrokeragePaymentPlan IN ('OneTime', 'TwoPart', 'AgreementOnly'));
GO