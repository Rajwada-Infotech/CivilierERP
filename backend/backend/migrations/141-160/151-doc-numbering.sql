-- ============================================================
-- Migration 151: Unified Document Numbering
-- Every Campaign, Ad, CRM Application/Booking/Agreement/Service
-- Ticket/Channel Partner/Cancellation gets a system-assigned
-- unique number in the form PREFIX-YYYY-00001. Leads are
-- explicitly excluded (they keep their existing LeadUid scheme).
-- ============================================================

-- Per-doc-type, per-year running counter
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmDocNumberSequence' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmDocNumberSequence (
    DocType     NVARCHAR(20) NOT NULL,
    Year        INT          NOT NULL,
    LastNumber  INT          NOT NULL DEFAULT 0,
    CONSTRAINT PK_CrmDocNumberSequence PRIMARY KEY (DocType, Year)
  );
  PRINT 'Created dbo.CrmDocNumberSequence';
END
GO

-- SaAd: add AdCode (unique system-assigned code, distinct from user-entered Name)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaAd') AND name = 'AdCode')
BEGIN
  ALTER TABLE dbo.SaAd ADD AdCode NVARCHAR(30) NULL;
  PRINT 'Added AdCode to SaAd';
END
GO

-- Backfill existing ads with a unique code derived from CreatedAt year, then lock the column down
IF EXISTS (SELECT 1 FROM dbo.SaAd WHERE AdCode IS NULL)
BEGIN
  ;WITH cte AS (
    SELECT Id, CreatedAt,
           ROW_NUMBER() OVER (PARTITION BY YEAR(ISNULL(CreatedAt, SYSDATETIME())) ORDER BY Id) AS rn
    FROM dbo.SaAd
    WHERE AdCode IS NULL
  )
  UPDATE a
  SET AdCode = 'AD-' + CAST(YEAR(ISNULL(cte.CreatedAt, SYSDATETIME())) AS NVARCHAR(4)) + '-' + RIGHT('00000' + CAST(cte.rn AS NVARCHAR(5)), 5)
  FROM dbo.SaAd a
  JOIN cte ON cte.Id = a.Id;
  PRINT 'Backfilled AdCode for existing ads';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_SaAd_AdCode' AND object_id = OBJECT_ID('dbo.SaAd'))
BEGIN
  CREATE UNIQUE INDEX UQ_SaAd_AdCode ON dbo.SaAd(AdCode) WHERE AdCode IS NOT NULL;
  PRINT 'Added UQ_SaAd_AdCode';
END
GO

-- Seed the AD sequence so future numbers continue after the backfilled ones
INSERT INTO dbo.CrmDocNumberSequence (DocType, Year, LastNumber)
SELECT 'AD', y.Yr, y.Cnt
FROM (
  SELECT YEAR(ISNULL(CreatedAt, SYSDATETIME())) AS Yr, COUNT(*) AS Cnt
  FROM dbo.SaAd
  GROUP BY YEAR(ISNULL(CreatedAt, SYSDATETIME()))
) y
WHERE NOT EXISTS (SELECT 1 FROM dbo.CrmDocNumberSequence s WHERE s.DocType = 'AD' AND s.Year = y.Yr);
GO

-- CrmCancellation: add CancellationNo (table is new in migration 150, safe to backfill+lock)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'CancellationNo')
BEGIN
  ALTER TABLE dbo.CrmCancellation ADD CancellationNo NVARCHAR(30) NULL;
  PRINT 'Added CancellationNo to CrmCancellation';
END
GO

IF EXISTS (SELECT 1 FROM dbo.CrmCancellation WHERE CancellationNo IS NULL)
BEGIN
  ;WITH cte AS (
    SELECT Id, RequestedDate,
           ROW_NUMBER() OVER (PARTITION BY YEAR(ISNULL(RequestedDate, SYSDATETIME())) ORDER BY Id) AS rn
    FROM dbo.CrmCancellation
    WHERE CancellationNo IS NULL
  )
  UPDATE c
  SET CancellationNo = 'CXL-' + CAST(YEAR(ISNULL(cte.RequestedDate, SYSDATETIME())) AS NVARCHAR(4)) + '-' + RIGHT('00000' + CAST(cte.rn AS NVARCHAR(5)), 5)
  FROM dbo.CrmCancellation c
  JOIN cte ON cte.Id = c.Id;
  PRINT 'Backfilled CancellationNo for existing rows';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmCancellation_No' AND object_id = OBJECT_ID('dbo.CrmCancellation'))
BEGIN
  CREATE UNIQUE INDEX UQ_CrmCancellation_No ON dbo.CrmCancellation(CancellationNo) WHERE CancellationNo IS NOT NULL;
  PRINT 'Added UQ_CrmCancellation_No';
END
GO

INSERT INTO dbo.CrmDocNumberSequence (DocType, Year, LastNumber)
SELECT 'CXL', y.Yr, y.Cnt
FROM (
  SELECT YEAR(ISNULL(RequestedDate, SYSDATETIME())) AS Yr, COUNT(*) AS Cnt
  FROM dbo.CrmCancellation
  GROUP BY YEAR(ISNULL(RequestedDate, SYSDATETIME()))
) y
WHERE NOT EXISTS (SELECT 1 FROM dbo.CrmDocNumberSequence s WHERE s.DocType = 'CXL' AND s.Year = y.Yr);
GO

-- Existing base36-timestamp codes (APP-/BKG-/AGR-/SVC-/CP-) remain valid as-is;
-- only the generator changes going forward to PREFIX-YYYY-00001. No backfill
-- needed there since old and new values can't collide (different suffix shape).
