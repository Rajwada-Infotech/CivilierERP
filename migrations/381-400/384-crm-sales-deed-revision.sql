-- Migration 384: CrmSalesDeedRevision — snapshot history for Sale Deed drafts.
-- A revision row is written every time Senior Approval rejects the deed,
-- capturing the values at the time of rejection so audit trails are complete.
-- VersionNo matches CrmSalesDeed.VersionNo at the time of snapshot — the deed's
-- VersionNo is then incremented, so the live deed is always VersionNo = N while
-- the revisions table holds 1..N-1. Mirrors CrmAgreementRevision.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmSalesDeedRevision' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmSalesDeedRevision (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    SalesDeedId     INT              NOT NULL REFERENCES dbo.CrmSalesDeed(Id),
    VersionNo       INT              NOT NULL,
    DeedValue       DECIMAL(18,2)    NULL,
    StampDuty       DECIMAL(18,2)    NULL,
    RegistrationFee DECIMAL(18,2)    NULL,
    StampDutyCredit DECIMAL(18,2)    NULL,
    SubRegistrarOffice NVARCHAR(255) NULL,
    Notes           NVARCHAR(MAX)    NULL,
    -- Human-readable reason why this version was superseded
    Reason          NVARCHAR(500)    NULL,
    CreatedBy       INT              NULL,
    CreatedAt       DATETIME2(3)     NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmSalesDeedRevision_DeedId ON dbo.CrmSalesDeedRevision(SalesDeedId);
  PRINT 'Created dbo.CrmSalesDeedRevision';
END
GO

PRINT 'Migration 384 complete — CrmSalesDeedRevision';
GO
