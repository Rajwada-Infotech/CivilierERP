-- Migration 541: audit log of automatic / manual monthly depreciation runs.
-- One row per period processed. The unique index on (PeriodYear, PeriodMonth) for the
-- Auto trigger doubles as a lock: if two app instances wake up at the same moment on the
-- 1st, only one can insert the 'Running' row and the other skips — and a period already
-- 'Completed' by the scheduler is never run again. (Per-asset double posting is already
-- impossible: UX_FADep_Asset_Period allows one live entry per asset per month.)

IF OBJECT_ID('dbo.FixedAssetDepreciationRun', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FixedAssetDepreciationRun (
    RunId         INT IDENTITY(1,1) PRIMARY KEY,
    PeriodYear    SMALLINT      NOT NULL,
    PeriodMonth   TINYINT       NOT NULL,
    TriggerType   NVARCHAR(10)  NOT NULL,            -- 'Auto' | 'Manual'
    Status        NVARCHAR(12)  NOT NULL,            -- 'Running' | 'Completed' | 'Failed'
    StartedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    FinishedAt    DATETIME2     NULL,
    RunBy         NVARCHAR(200) NULL,
    Eligible      INT           NOT NULL DEFAULT 0,  -- tagged, active, depreciation configured
    Posted        INT           NOT NULL DEFAULT 0,
    AlreadyPosted INT           NOT NULL DEFAULT 0,
    Skipped       INT           NOT NULL DEFAULT 0,  -- not in service yet / fully depreciated / stopped
    Failed        INT           NOT NULL DEFAULT 0,
    NotConfigured INT           NOT NULL DEFAULT 0,  -- tagged + active but no cost / rate / method / date
    TotalAmount   DECIMAL(18,2) NOT NULL DEFAULT 0,
    Details       NVARCHAR(MAX) NULL,                -- JSON: per-asset reasons for skipped / failed / not configured
    CONSTRAINT CK_FADepRun_Trigger CHECK (TriggerType IN ('Auto', 'Manual')),
    CONSTRAINT CK_FADepRun_Status  CHECK (Status IN ('Running', 'Completed', 'Failed'))
  );
  CREATE UNIQUE INDEX UX_FADepRun_Auto_Period
    ON dbo.FixedAssetDepreciationRun (PeriodYear, PeriodMonth)
    WHERE TriggerType = 'Auto' AND Status <> 'Failed';
  PRINT 'Migration 541: created FixedAssetDepreciationRun.';
END
GO
