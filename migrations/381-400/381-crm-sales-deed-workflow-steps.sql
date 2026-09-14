-- Migration 381: Add internal workflow step tracking to CrmSalesDeed
-- Mirrors the step-tracking pattern used for CrmAgreement.
-- Steps: DocCollection → DeedDrafting → InternalApproval (manual) →
--        Customer Review → Director Approval (auto, already tracked) →
--        Stamp Duty Payment (cross-link to CrmQueryPayment) →
--        SRO Appointment (cross-link to CrmRegistry.ScheduledDate — NOT stored here) →
--        Execution → Registration (auto) → Index II Received

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DocCollectionDone')
    ALTER TABLE dbo.CrmSalesDeed ADD DocCollectionDone BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DocCollectionDate')
    ALTER TABLE dbo.CrmSalesDeed ADD DocCollectionDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DocCollectionNotes')
    ALTER TABLE dbo.CrmSalesDeed ADD DocCollectionNotes NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DeedDraftingDone')
    ALTER TABLE dbo.CrmSalesDeed ADD DeedDraftingDone BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DeedDraftingDate')
    ALTER TABLE dbo.CrmSalesDeed ADD DeedDraftingDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DeedDraftingNotes')
    ALTER TABLE dbo.CrmSalesDeed ADD DeedDraftingNotes NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'InternalApprovalDone')
    ALTER TABLE dbo.CrmSalesDeed ADD InternalApprovalDone BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'InternalApprovalDate')
    ALTER TABLE dbo.CrmSalesDeed ADD InternalApprovalDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'InternalApprovalNotes')
    ALTER TABLE dbo.CrmSalesDeed ADD InternalApprovalNotes NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'Index2ReceivedDate')
    ALTER TABLE dbo.CrmSalesDeed ADD Index2ReceivedDate DATE NULL;
