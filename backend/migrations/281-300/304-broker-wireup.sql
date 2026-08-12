-- Run against Civilier DB. Companion to the CrmBooking/CrmBrokerageMaster
-- migration already applied — adds the same plan field to CrmApplication,
-- where it's actually captured by staff (see crmApplications.js PUT /:id),
-- then copied onto CrmBooking at booking-creation time.
--
-- BrokerageSplitEnabled is left in place on both tables (harmless, unused
-- going forward) rather than dropped, in case anything outside this
-- codebase's uploaded files still reads it — safe to drop later once
-- confirmed dead.

ALTER TABLE dbo.CrmApplication
  ADD BrokeragePaymentPlan NVARCHAR(20) NOT NULL
    CONSTRAINT DF_CrmApplication_BrokeragePaymentPlan DEFAULT 'OneTime'
    CONSTRAINT CK_CrmApplication_BrokeragePaymentPlan
      CHECK (BrokeragePaymentPlan IN ('OneTime', 'TwoPart', 'AgreementOnly'));