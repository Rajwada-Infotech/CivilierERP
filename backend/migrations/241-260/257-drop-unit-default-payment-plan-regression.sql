-- 257-drop-unit-default-payment-plan-regression.sql
--
-- NOTE ON NUMBERING: check dbo.__Migrations for the actual latest applied
-- filename before running; renumber if 257 is already taken.
--
-- 203-unit-payment-plan-tagging.sql deliberately replaced UnitMaster's
-- single DefaultPaymentPlanId with the CrmUnitPaymentPlan many-to-many tag
-- table: a unit can be tagged with 1+ Payment Plans, and picking one is
-- mandatory at Application time (see resolveApplicationPaymentPlan in
-- crmEntityCreation.js) -- there is no such thing as "the" default plan for
-- a unit with more than one tag.
--
-- 247-unit-master-default-payment-plan.sql re-added DefaultPaymentPlanId,
-- reintroducing the single-plan model 203 removed. Nothing in Unit Master's
-- UI ever wrote to it (the tagging UI only ever wrote to CrmUnitPaymentPlan),
-- so the column sat permanently NULL -- but application code built against
-- it (crmApplications.js PUT /:id, crmBookings.js PUT /:id and
-- /:id/change-unit) called a validatePaymentPlanScope() helper that no
-- longer exists post-203/204, causing those routes to throw whenever a
-- payment plan was touched. All three routes have been switched back to
-- resolveApplicationPaymentPlan (the tag-table-based resolver already used
-- by Application/Booking creation), so this column and its callers are
-- fully dead. Dropping it again so a future migration doesn't reintroduce
-- the same regression a third time.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'DefaultPaymentPlanId')
BEGIN
    DECLARE @dfConstraint NVARCHAR(200);
    SELECT @dfConstraint = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.UnitMaster') AND c.name = 'DefaultPaymentPlanId';

    IF @dfConstraint IS NOT NULL
        EXEC('ALTER TABLE dbo.UnitMaster DROP CONSTRAINT ' + @dfConstraint);

    ALTER TABLE dbo.UnitMaster DROP COLUMN DefaultPaymentPlanId;
END
GO