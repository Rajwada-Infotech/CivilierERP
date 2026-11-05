-- Migration 571: "the raiser may approve their own request" is a setting.
--
-- Until now the modules where whoever raised a request can't approve it were
-- a fixed list in services/approvalService.js (MAKER_COLUMNS). That is a
-- business choice, so it now lives here, one row per module, and an admin
-- sets it in Approval Setup. The code keeps only which column records who
-- raised each request.
--
-- Seeded with today's behaviour, except resales (business decision
-- 2026-10-14: whoever sends a resale / buy-back for approval may approve it).
-- Credit notes already allowed it (decided earlier), and so do transfer-deed
-- papers (whoever uploads one may verify it, decided 2026-10-14). Existing rows are never
-- overwritten. Safe to run again.
IF OBJECT_ID(N'dbo.ApprovalRaiserRule', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ApprovalRaiserRule (
    Module           NVARCHAR(100) NOT NULL CONSTRAINT PK_ApprovalRaiserRule PRIMARY KEY,
    RaiserMayApprove BIT           NOT NULL CONSTRAINT DF_ApprovalRaiserRule_May DEFAULT (0),
    UpdatedBy        NVARCHAR(100) NULL,
    UpdatedAt        DATETIME2     NOT NULL CONSTRAINT DF_ApprovalRaiserRule_At DEFAULT (SYSDATETIME())
  );
END
GO

MERGE dbo.ApprovalRaiserRule AS t
USING (VALUES
  (N'crm-cancellations',      0),
  (N'crm-refunds',            0),
  (N'crm-brokerage',          0),
  (N'crm-transfer-deeds',     0),
  (N'crm-ownership-changes',  0),
  (N'crm-resales',            1),
  (N'crm-credit-notes',       1),
  (N'crm-credit-note-cancel', 1),
  (N'crm-transfer-deed-papers', 1)
) AS s (Module, RaiserMayApprove)
ON t.Module = s.Module
WHEN NOT MATCHED THEN INSERT (Module, RaiserMayApprove, UpdatedBy) VALUES (s.Module, s.RaiserMayApprove, N'migration 571');
GO
