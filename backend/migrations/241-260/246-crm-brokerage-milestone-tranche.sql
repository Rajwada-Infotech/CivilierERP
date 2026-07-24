-- Brokerage used to release in at most two fixed tranches ("Before
-- Agreement" / "After Agreement", see migration in 221-240 that added
-- TrancheLabel/IsLocked). The actual requirement is finer-grained: a
-- broker's payout should follow the SAME milestone schedule the customer's
-- own payments do — one tranche per payment milestone, each unlocking the
-- moment that specific milestone is paid. MilestoneId lets the unlock be
-- driven directly off a specific CrmPaymentMilestone row; MilestoneNo is
-- kept alongside for display even if the milestone itself is later deleted
-- (FK-less by the same no-hard-FK convention already used for BrokerId).
ALTER TABLE dbo.CrmBrokerageMaster ADD MilestoneId INT NULL, MilestoneNo INT NULL;
