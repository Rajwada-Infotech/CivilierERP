-- Migration 385: CrmSalesDeedApprovalLog — human-friendly audit trail for
-- every approval-related action on a Sale Deed.
-- Actions include: SeniorApprove, SeniorReject, SendToCustomer,
--   CustomerApprove, CustomerRecheck, DirectorApprove, DirectorReject.
-- Mirrors CrmAgreementApprovalLog in structure and purpose.
-- The system also writes a generic ApprovalAuditLog entry through the
-- approvalService engine — this table provides the CRM-friendly, action-named
-- version that is shown in the UI timeline. Both are written; neither replaces
-- the other.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmSalesDeedApprovalLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmSalesDeedApprovalLog (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    SalesDeedId  INT              NOT NULL REFERENCES dbo.CrmSalesDeed(Id),
    -- SeniorApprove | SeniorReject | SendToCustomer | CustomerApprove |
    -- CustomerRecheck | CustomerApprovalVoided | DirectorApprove | DirectorReject
    Action       NVARCHAR(40)     NOT NULL,
    Remarks      NVARCHAR(MAX)    NULL,
    -- Staff | Customer | System
    ActorType    NVARCHAR(20)     NOT NULL DEFAULT 'Staff',
    ActorId      INT              NULL,
    CreatedAt    DATETIME2(3)     NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmSalesDeedApprovalLog_DeedId ON dbo.CrmSalesDeedApprovalLog(SalesDeedId);
  PRINT 'Created dbo.CrmSalesDeedApprovalLog';
END
GO

PRINT 'Migration 385 complete — CrmSalesDeedApprovalLog';
GO
