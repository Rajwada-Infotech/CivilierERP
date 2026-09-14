-- Migration 374: CrmMutation — post-registration mutation (Khata Transfer) tracker.
--
-- Mutation (also called Khata Transfer / Property Tax Transfer) is the process
-- of updating the municipal authority's records to reflect the new owner after
-- the Sale Deed has been officially registered at the Sub-Registrar Office.
-- Done at the local body (GHMC, MCGM, BDA, Gram Panchayat, etc.).
--
-- Gate: Sale Deed Registry must be Completed (CrmRegistry.Status = 'Completed')
-- because mutation can only proceed once the deed is officially on record.
-- One mutation tracker per booking (UNIQUE on BookingId).
-- Status: Applied -> Approved.

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CrmMutation') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.CrmMutation (
    Id              INT           IDENTITY(1,1) PRIMARY KEY,
    MutationNo      NVARCHAR(30)  NOT NULL,
    BookingId       INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    -- 'Applied' -> 'Approved'
    Status          NVARCHAR(20)  NOT NULL DEFAULT 'Applied',
    ApplicationNo   NVARCHAR(100) NULL,
    ApplicationDate DATE          NULL,
    ApprovedNo      NVARCHAR(100) NULL,
    ApprovedDate    DATE          NULL,
    Authority       NVARCHAR(200) NULL,
    Remarks         NVARCHAR(MAX) NULL,
    CreatedBy       INT           NOT NULL,
    CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2     NULL,
    CONSTRAINT UQ_CrmMutation_BookingId UNIQUE (BookingId)
  );
  PRINT 'Created CrmMutation';
END
GO

-- Page definition in CRM Legal section, after Registry (SortOrder 910)
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-mutation', 'Mutation / Khata Transfer', 'CRM', 'CRM Legal', 'view,create,edit', 911, 1, 'migration-374')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName, SortOrder FROM dbo.PageDefinitions WHERE PageKey = 'crm-mutation';
GO
