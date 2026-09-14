-- Migration 425: consolidate "Advance from Customers A/c" onto the
-- pre-existing "Advance from Customer" GL head
--
-- Migration 424 seeded a brand-new pooled head named "Advance from
-- Customers A/c" (Code=ADVC-CUST) for standalone advance postings. On
-- production, a head named "Advance from Customer" (Code=AFC, filed
-- directly under CURRENT LIABILITIES) already existed by hand and was
-- never posted to. Per explicit instruction, consolidate onto that
-- pre-existing head instead of carrying two GL heads for the same concept:
--   - If "Advance from Customer" already exists (production): reassign
--     every GeneralLedgerEntry currently on "Advance from Customers A/c"
--     onto it, fold its OnAccountBalance in, force LHeadType='GL' so
--     generalLedger.js's getGLHeadId() can resolve it, then delete the
--     now-empty "Advance from Customers A/c" head.
--   - Otherwise (dev, no such pre-existing head): nothing to merge — just
--     rename the migration-424 head in place to the same target name, so
--     both environments converge on identical naming.
-- Resolved by exact LHeadName, matching getGLHeadId()'s own convention —
-- no hardcoded LHeadId, which is not stable across environments.

DECLARE @NewHeadId INT = (SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Advance from Customer');
DECLARE @OldHeadId INT = (SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = 'ADVC-CUST');

IF @OldHeadId IS NULL
BEGIN
  PRINT 'No ADVC-CUST head found — nothing to consolidate.';
END
ELSE IF @NewHeadId IS NULL
BEGIN
  -- No pre-existing "Advance from Customer" head (e.g. dev) — rename the
  -- migration-424 head in place, same LHeadId, nothing to move.
  UPDATE dbo.AccountHeadMaster SET LHeadName = 'Advance from Customer' WHERE LHeadId = @OldHeadId;
  PRINT 'Renamed ADVC-CUST head to "Advance from Customer" (no pre-existing head found).';
END
ELSE IF @NewHeadId = @OldHeadId
BEGIN
  PRINT 'Already consolidated.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRAN;

  UPDATE dbo.GeneralLedgerEntry SET LHeadId = @NewHeadId WHERE LHeadId = @OldHeadId;

  UPDATE n
    SET n.OnAccountBalance = ISNULL(n.OnAccountBalance, 0) + ISNULL(o.OnAccountBalance, 0),
        n.LHeadType = 'GL'
    FROM dbo.AccountHeadMaster n
    JOIN dbo.AccountHeadMaster o ON o.LHeadId = @OldHeadId
    WHERE n.LHeadId = @NewHeadId;

  DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @OldHeadId;

  COMMIT TRAN;
  PRINT 'Consolidated "Advance from Customers A/c" onto "Advance from Customer" and deleted the duplicate head.';
END
GO
