-- Run against Civilier DB before deploying the code change below.

ALTER TABLE dbo.CrmBooking
  ADD BrokeragePaymentPlan NVARCHAR(20) NOT NULL
    CONSTRAINT DF_CrmBooking_BrokeragePaymentPlan DEFAULT 'OneTime'
    CONSTRAINT CK_CrmBooking_BrokeragePaymentPlan
      CHECK (BrokeragePaymentPlan IN ('OneTime', 'TwoPart', 'AgreementOnly'));

-- Replaces MilestoneId as the thing a tranche is locked against, since
-- TwoPart/AgreementOnly tranches gate on the Agreement, not a milestone.
ALTER TABLE dbo.CrmBrokerageMaster
  ADD UnlockGate NVARCHAR(20) NULL
    CONSTRAINT CK_CrmBrokerageMaster_UnlockGate
      CHECK (UnlockGate IN ('Booking', 'Agreement', 'Milestone'));