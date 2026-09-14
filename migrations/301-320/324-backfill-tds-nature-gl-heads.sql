-- Migration 324: backfill any dbo.TDSMaster row still missing GLHeadId.
--
-- Migrations 313/314 linked a system GL head to every TDS Nature that
-- existed at the time (and fixed a variable-reuse bug that made every
-- Nature after the first silently reuse the 194C head) — but any TDS
-- record added or edited since then (via the TDS Master page, or a CSV
-- import, both of which never set GLHeadId until this session's UI fix)
-- is still stuck at GLHeadId = NULL. Invoice posting requires it once
-- TDSAmount > 0 ("TDS Nature system ledger not configured for <nature>
-- — link a GL head in TDS Master"), so any invoice using one of these
-- records fails to auto-post.
--
-- One head per TDSMaster row (keyed by TDSId, not by Nature text) —
-- LHeadCode is only NVARCHAR(20), too short to safely derive from a
-- free-text Nature description, so TDSId is used instead: always short,
-- always unique. Reuses an existing head by LHeadName when one already
-- matches, same as 313/314, so re-running this migration is a no-op.

DECLARE @IndirectExpenses INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'IE');
DECLARE @SystemUserId INT = (
  SELECT TOP 1 u.id FROM dbo.users u
  JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE r.RName IN ('super_admin', 'admin')
  ORDER BY u.id
);

DECLARE @TDSId INT, @Nature NVARCHAR(50), @HeadName NVARCHAR(200), @HeadCode NVARCHAR(20), @NewHeadId INT;

DECLARE tds_backfill_cursor CURSOR LOCAL FOR
  SELECT TDSId, Nature FROM dbo.TDSMaster WHERE GLHeadId IS NULL;
OPEN tds_backfill_cursor;
FETCH NEXT FROM tds_backfill_cursor INTO @TDSId, @Nature;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @HeadName = LEFT(CONCAT('TDS ', ISNULL(@Nature, CONCAT('#', @TDSId)), ' A/c'), 200);
  SET @NewHeadId = NULL; -- reset every loop — see 313's own comment on why

  SELECT @NewHeadId = LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @HeadName AND LHeadType = 'GL';
  IF @NewHeadId IS NULL
  BEGIN
    SET @HeadCode = CONCAT('TDS-', @TDSId);
    INSERT INTO dbo.AccountHeadMaster (
      LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadStatus,
      LHeadPaymentTerms, LHeadCreditLimit, LBranchName, LGstType, LTDSDeduction,
      LCountry, CreatedBy, CreatedAt, isEdited, LHeadCode, Status,
      IsSystemGenerated, IsTdsApplicable, OnAccountBalance, TdsLimitApplicable,
      LBelongsTo
    )
    VALUES (
      @HeadName, 'N/A', 'GL', 'N/A', 1,
      'N/A', 0, 'Main', 'Unregistered', 0,
      'India', @SystemUserId, GETDATE(), 0, @HeadCode, 'Draft',
      1, 0, 0, 1,
      @IndirectExpenses
    );
    SET @NewHeadId = SCOPE_IDENTITY();
  END

  UPDATE dbo.TDSMaster SET GLHeadId = @NewHeadId WHERE TDSId = @TDSId;

  FETCH NEXT FROM tds_backfill_cursor INTO @TDSId, @Nature;
END
CLOSE tds_backfill_cursor;
DEALLOCATE tds_backfill_cursor;
GO

PRINT '324-backfill-tds-nature-gl-heads applied successfully.';
GO
