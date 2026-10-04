-- Migration 424: "Advance from Customers A/c" system GL head
--
-- The "ADVANCE FROM CUSTOMER" AccountGroup (Code='AFC', under CURRENT
-- LIABILITIES) already exists on dev — created by hand at some point, no
-- migration record — but nothing ever posted to it. A standalone Received
-- Payment (no invoice, no contract, not a CRM milestone/booking payment —
-- i.e. money received with nothing yet to apply it against) used to post
-- straight to the customer's own Sundry Debtors head instead, which is
-- wrong: an advance is a liability (goods/services still owed), not a
-- reduction of what the customer owes US.
--
-- This seeds the group (get-or-create, in case an environment doesn't
-- have it yet) and a single pooled system head under it — same pattern
-- as "Company On Account A/c" on the supplier side (migration 178).
-- Resolved everywhere by Name (LHeadType='GL' + exact name, via
-- generalLedger.js's getGLHeadId), not a hardcoded AGId/LHeadId — AGId
-- is not stable across dev/production for the same group.

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Code = 'AFC')
BEGIN
  DECLARE @CurrentLiabId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'CL');
  IF @CurrentLiabId IS NULL
  BEGIN
    RAISERROR('CURRENT LIABILITIES (Code=CL) AccountGroup not found', 16, 1);
    RETURN;
  END
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId)
  VALUES ('ADVANCE FROM CUSTOMER', 'AFC', @CurrentLiabId);
  PRINT 'Created AccountGroup: ADVANCE FROM CUSTOMER (Code=AFC) under CURRENT LIABILITIES';
END
ELSE
  PRINT 'AccountGroup ADVANCE FROM CUSTOMER (Code=AFC) already exists — skipped.';
GO

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Advance from Customers A/c' AND LHeadType = 'GL'
)
BEGIN
  DECLARE @AfcGroupId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'AFC');
  IF @AfcGroupId IS NULL
  BEGIN
    RAISERROR('ADVANCE FROM CUSTOMER (Code=AFC) AccountGroup not found', 16, 1);
    RETURN;
  END
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, LHeadAddress, LHeadContactPerson,
     LHeadPaymentTerms, LBranchName, LCountry, LBelongsTo, DisplayName, LDescription,
     CreatedBy, CreatedAt)
  VALUES
    ('Advance from Customers A/c', 'ADVC-CUST', 'GL', 1, 'N/A', 'N/A', 'N/A', 'Main', 'India',
     @AfcGroupId, 'Advance from Customers',
     'Pooled liability for standalone Received Payments with no invoice/contract/CRM booking to apply against — see generalLedger.js''s postReceivedPaymentApproval.',
     'migration', GETDATE());
  PRINT 'Seeded: Advance from Customers A/c GL head';
END
ELSE
  PRINT 'Advance from Customers A/c GL head already exists — skipped.';
GO
