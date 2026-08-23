-- Make SaLead.Mobile the active-lead identity key used by both manual entry
-- and ad imports. Obvious legacy formatting is normalized before the unique
-- guard is created; unresolved duplicates fail loudly for manual cleanup.

IF COL_LENGTH('dbo.SaLead', 'Mobile') IS NOT NULL
BEGIN
  UPDATE dbo.SaLead
  SET Mobile =
    CASE
      WHEN LEN(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) = 11
           AND LEFT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1) = '0'
        THEN SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 2, 10)
      WHEN LEN(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) = 12
           AND LEFT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 2) = '91'
        THEN SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 3, 10)
      ELSE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')
    END
  WHERE Mobile IS NOT NULL
    AND Mobile <> ''
    AND (
      Mobile LIKE '% %'
      OR Mobile LIKE '%-%'
      OR Mobile LIKE '%(%'
      OR Mobile LIKE '%)%'
      OR Mobile LIKE '%.%'
      OR Mobile LIKE '+91%'
      OR Mobile LIKE '91__________'
      OR Mobile LIKE '0__________'
    );

  IF EXISTS (
    SELECT 1
    FROM dbo.SaLead
    WHERE IsActive = 1
      AND Mobile IS NOT NULL
      AND LTRIM(RTRIM(Mobile)) <> ''
    GROUP BY Mobile
    HAVING COUNT(*) > 1
  )
  BEGIN
    THROW 51073, 'Cannot create UQ_SaLead_Mobile: duplicate active lead mobile numbers exist. Merge or deactivate duplicates first.', 1;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.SaLead')
      AND name = 'UQ_SaLead_Mobile'
  )
  BEGIN
    CREATE UNIQUE INDEX UQ_SaLead_Mobile
      ON dbo.SaLead(Mobile)
      WHERE IsActive = 1 AND Mobile IS NOT NULL AND Mobile <> '';
  END;
END;
