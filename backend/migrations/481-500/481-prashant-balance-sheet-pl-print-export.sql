-- Migration 481: give Prashant view + print + export on the Balance Sheet and
-- Profit & Loss pages.
--
-- Rights are a per-user JSON override in dbo.UserPageRightsJson. This merges
-- into whatever Prashant already has (no exact-JSON match needed), leaves every
-- other page untouched, and is idempotent. It only acts when exactly one active
-- user is named Prashant; otherwise (e.g. a dev DB without him) it prints why
-- and does nothing, so grant it from Menu Rights instead.

DECLARE @UserId INT;
DECLARE @Matches INT;

SELECT @Matches = COUNT(*) FROM dbo.Users
WHERE name LIKE N'Prashant%' AND ISNULL(discontinue, 0) = 0;

IF @Matches <> 1
BEGIN
  PRINT CONCAT('Migration 481 SKIPPED: found ', @Matches, ' active users named Prashant (need exactly 1). Grant balance-sheet / profit-and-loss view+print+export via Menu Rights.');
END
ELSE
BEGIN
  SELECT @UserId = id FROM dbo.Users WHERE name LIKE N'Prashant%' AND ISNULL(discontinue, 0) = 0;

  DECLARE @Json NVARCHAR(MAX) = (SELECT TOP 1 RightsJson FROM dbo.UserPageRightsJson WHERE UserId = @UserId AND IsActive = 1);
  DECLARE @Grant NVARCHAR(MAX) = N'["view","print","export"]';
  DECLARE @Page NVARCHAR(60);
  DECLARE @Pages TABLE (PageKey NVARCHAR(60));
  INSERT INTO @Pages VALUES (N'balance-sheet'), (N'profit-and-loss');

  IF @Json IS NULL
  BEGIN
    SET @Json = N'[]';
    IF EXISTS (SELECT 1 FROM dbo.UserPageRightsJson WHERE UserId = @UserId)
      UPDATE dbo.UserPageRightsJson SET RightsJson = @Json, IsActive = 1, UpdatedAt = GETDATE() WHERE UserId = @UserId;
    ELSE
      INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive) VALUES (@UserId, @Json, 1);
  END

  DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT PageKey FROM @Pages;
  OPEN c;
  FETCH NEXT FROM c INTO @Page;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    -- Rebuild the array without any existing entry for this page, then append
    -- the new one that unions the old actions with view/print/export.
    DECLARE @OldActions NVARCHAR(MAX) = (
      SELECT TOP 1 a.actions FROM OPENJSON(@Json) WITH (page NVARCHAR(60) '$.page', actions NVARCHAR(MAX) '$.actions' AS JSON) a
      WHERE a.page = @Page
    );
    DECLARE @Merged NVARCHAR(MAX) = (
      SELECT '"' + v.action + '"' + ',' AS [text()]
      FROM (
        SELECT DISTINCT [value] AS action FROM OPENJSON(@Grant)
        UNION
        SELECT [value] FROM OPENJSON(ISNULL(@OldActions, N'[]'))
      ) v
      FOR XML PATH('')
    );
    SET @Merged = N'[' + LEFT(@Merged, LEN(@Merged) - 1) + N']';

    DECLARE @Kept NVARCHAR(MAX) = (
      SELECT STRING_AGG(CAST(j.[value] AS NVARCHAR(MAX)), ',')
      FROM OPENJSON(@Json) j
      WHERE JSON_VALUE(j.[value], '$.page') <> @Page
    );
    SET @Json = N'[' + ISNULL(@Kept + ',', '') + N'{"page":"' + @Page + N'","actions":' + @Merged + N'}]';

    FETCH NEXT FROM c INTO @Page;
  END
  CLOSE c; DEALLOCATE c;

  UPDATE dbo.UserPageRightsJson SET RightsJson = @Json, UpdatedAt = GETDATE() WHERE UserId = @UserId AND IsActive = 1;
  PRINT CONCAT('Migration 481 applied: UserId ', @UserId, ' now has view/print/export on balance-sheet and profit-and-loss.');
END
GO
