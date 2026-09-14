-- Run against Civilier DB before deploying the code change below.
--
-- Both columns below were applied directly against the live DB before this
-- file was ever run through umzug (same pattern as migrations 153/154 —
-- see the migration-tracker baseline notes), which is why the tracker
-- listed this as still-pending while the schema already had it. Guarded
-- with IF NOT EXISTS, matching every other migration in this codebase, so
-- it's a safe no-op here and a real apply anywhere it's still missing.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'BrokeragePaymentPlan')
  ALTER TABLE dbo.CrmBooking
    ADD BrokeragePaymentPlan NVARCHAR(20) NOT NULL
      CONSTRAINT DF_CrmBooking_BrokeragePaymentPlan DEFAULT 'OneTime'
      CONSTRAINT CK_CrmBooking_BrokeragePaymentPlan
        CHECK (BrokeragePaymentPlan IN ('OneTime', 'TwoPart', 'AgreementOnly'));
GO

-- Replaces MilestoneId as the thing a tranche is locked against, since
-- TwoPart/AgreementOnly tranches gate on the Agreement, not a milestone.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'UnlockGate')
  ALTER TABLE dbo.CrmBrokerageMaster
    ADD UnlockGate NVARCHAR(20) NULL
      CONSTRAINT CK_CrmBrokerageMaster_UnlockGate
        CHECK (UnlockGate IN ('Booking', 'Agreement', 'Milestone'));
GO