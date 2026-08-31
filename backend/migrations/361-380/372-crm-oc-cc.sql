-- Migration 372: CrmOccupancyCertificate — project-level OC/CC tracker.
--
-- The Occupancy Certificate (OC) and/or Completion Certificate (CC) is issued
-- by the local municipal authority (GHMC, MCGM, BDA, etc.) certifying that the
-- building is safe for occupancy. A project cannot legally hand over possession
-- to buyers without OC/CC in hand.
--
-- This is a project-level tracker (one or more rows per project — a project may
-- apply separately for OC and CC, or reapply after rejection). No booking FK.
-- Status: Applied -> Received.
-- ProjectId / ProjectName are sourced from the Unit Master (dbo.enterprise, business_type='P').

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CrmOccupancyCertificate') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.CrmOccupancyCertificate (
    Id              INT           IDENTITY(1,1) PRIMARY KEY,
    ProjectId       INT           NOT NULL,
    ProjectName     NVARCHAR(200) NOT NULL,
    -- 'OC' | 'CC' | 'OC+CC'
    CertType        NVARCHAR(20)  NOT NULL DEFAULT 'OC',
    -- 'Applied' | 'Received'
    Status          NVARCHAR(20)  NOT NULL DEFAULT 'Applied',
    ApplicationDate DATE          NULL,
    ReceivedDate    DATE          NULL,
    CertificateNo   NVARCHAR(100) NULL,
    IssuedBy        NVARCHAR(200) NULL,
    Remarks         NVARCHAR(MAX) NULL,
    CreatedBy       INT           NOT NULL,
    CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2     NULL
  );
  PRINT 'Created CrmOccupancyCertificate';
END
GO

-- Page definition
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-oc-cc', 'OC / CC (Occupancy & Completion Certificate)', 'CRM', 'CRM Closure', 'view,create,edit', 815, 1, 'migration-372')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName, SortOrder FROM dbo.PageDefinitions WHERE PageKey = 'crm-oc-cc';
GO
