-- Migration 371: CrmAfsRegistry — Sub-Registrar Visit 1 tracker.
--
-- Mirrors CrmRegistry (Visit 2 / Sale Deed registration) but covers the AFS
-- registration step (Visit 1). The customer pays AFS stamp duty (tracked by
-- CrmAfsQueryPayment) and then both parties attend the Sub-Registrar Office
-- to have the Agreement for Sale physically registered.
--
-- Gate to start: CrmAfsQueryPayment.Status = 'Confirmed'.
-- Once Completed, the actual registration details (AfsRegistrationNo,
-- AfsRegistrationDate, AfsStampDuty, AfsRegistrationFee) are entered on the
-- Agreement via crmAgreements.js PUT /:id/mark-registered — that data stays
-- on CrmAgreement exactly as before; CrmAfsRegistry only tracks the workflow
-- gate/checkpoint, not duplicate data.

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CrmAfsRegistry') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.CrmAfsRegistry (
    Id            INT           IDENTITY(1,1) PRIMARY KEY,
    AfsRegNo      NVARCHAR(30)  NOT NULL,
    BookingId     INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    AgreementId   INT           NULL     REFERENCES dbo.CrmAgreement(Id),
    -- 'Pending' -> 'Scheduled' -> 'Completed'
    Status        NVARCHAR(20)  NOT NULL DEFAULT 'Pending',
    ScheduledDate DATE          NULL,
    CompletedDate DATE          NULL,
    Remarks       NVARCHAR(MAX) NULL,
    CreatedBy     INT           NOT NULL,
    CreatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy     INT           NULL,
    UpdatedAt     DATETIME2     NULL,
    CONSTRAINT UQ_CrmAfsRegistry_BookingId UNIQUE (BookingId)
  );
  PRINT 'Created CrmAfsRegistry';
END
GO

-- Page definition
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-afs-registry', 'AFS Registry (Sub-Registrar Visit 1)', 'CRM', 'CRM Legal', 'view,create,edit', 907, 1, 'migration-371')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey = 'crm-afs-registry';
GO
