-- Migration 373: CrmAllotmentLetter — RERA-mandated allotment letter per booking.
--
-- After a booking is made, the developer must issue an Allotment Letter to the
-- buyer confirming the unit allotted to them (unit details, booking amount, RERA
-- registration number, payment schedule reference). Under RERA this is mandatory
-- and must be issued within the stipulated timeframe.
--
-- One letter per booking (UNIQUE on BookingId). Status: Draft -> Issued.
-- The letter PDF can be attached when marking Issued (stored inline as VARBINARY).
-- Gate to start: booking must be active (no downstream dependency required —
-- issued right after booking is the typical flow).

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CrmAllotmentLetter') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.CrmAllotmentLetter (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    AlNo      NVARCHAR(30)  NOT NULL,
    BookingId INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    -- 'Draft' -> 'Issued'
    Status    NVARCHAR(20)  NOT NULL DEFAULT 'Draft',
    DraftedOn DATE          NULL,
    IssuedOn  DATE          NULL,
    Remarks   NVARCHAR(MAX) NULL,
    -- Optional: the actual letter PDF stored inline
    FileName  NVARCHAR(255) NULL,
    MimeType  NVARCHAR(100) NULL,
    FileSize  INT           NULL,
    FileData  VARBINARY(MAX) NULL,
    CreatedBy INT           NOT NULL,
    CreatedAt DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy INT           NULL,
    UpdatedAt DATETIME2     NULL,
    CONSTRAINT UQ_CrmAllotmentLetter_BookingId UNIQUE (BookingId)
  );
  PRINT 'Created CrmAllotmentLetter';
END
GO

-- Page definition in CRM Documents section, before Agreements (SortOrder 840)
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-allotment-letter', 'Allotment Letter (RERA)', 'CRM', 'CRM Documents', 'view,create,edit', 836, 1, 'migration-373')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName, SortOrder FROM dbo.PageDefinitions WHERE PageKey = 'crm-allotment-letter';
GO
