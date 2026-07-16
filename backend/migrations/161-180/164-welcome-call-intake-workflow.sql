-- ============================================================
-- Migration 164: Welcome Call intake workflow
-- Welcome Call becomes a queue + per-booking checklist: ad-hoc custom
-- fields per call, a preferred agreement date captured during the call,
-- and two genuinely new sub-steps (document verification, co-applicant
-- capture). Bank/Nominee details, NOC, and Agreement stay on their own
-- pages — this only adds the pieces that don't exist anywhere yet.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmWelcomeCall') AND name = 'CustomFields')
BEGIN
  ALTER TABLE dbo.CrmWelcomeCall ADD CustomFields NVARCHAR(MAX) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmWelcomeCall') AND name = 'PreferredAgreementDate')
BEGIN
  ALTER TABLE dbo.CrmWelcomeCall ADD PreferredAgreementDate DATE NULL;
END
GO

-- ── Co-Applicant (a booking may have zero, one, or several) ────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmCoApplicant' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmCoApplicant (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    BookingId   INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    Name        NVARCHAR(200) NOT NULL,
    Relation    NVARCHAR(50)  NULL,
    Mobile      NVARCHAR(20)  NULL,
    Email       NVARCHAR(200) NULL,
    PanNo       NVARCHAR(20)  NULL,
    AadhaarNo   NVARCHAR(20)  NULL,
    Notes       NVARCHAR(MAX) NULL,
    IsActive    BIT           NOT NULL DEFAULT 1,
    CreatedBy   INT           NULL,
    CreatedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy   INT           NULL,
    UpdatedAt   DATETIME2(3)  NULL
  );
  CREATE INDEX IX_CrmCoApplicant_Booking ON dbo.CrmCoApplicant(BookingId);
  PRINT 'Created dbo.CrmCoApplicant';
END
GO

-- ── Booking-level document/attachment verification (ID proof, address
-- proof, photo, etc.) — distinct from CrmAgreementDocument, which is
-- specifically the agreement's own document set collected later.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBookingDocument' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBookingDocument (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    BookingId    INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    DocumentType NVARCHAR(100) NOT NULL,
    DocumentUrl  NVARCHAR(2000) NULL,
    FileName     NVARCHAR(300) NULL,
    IsVerified   BIT           NOT NULL DEFAULT 0,
    VerifiedBy   INT           NULL,
    VerifiedAt   DATETIME2(3)  NULL,
    Notes        NVARCHAR(MAX) NULL,
    CreatedBy    INT           NULL,
    CreatedAt    DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmBookingDocument_Booking ON dbo.CrmBookingDocument(BookingId);
  PRINT 'Created dbo.CrmBookingDocument';
END
GO

PRINT 'Migration 164 complete — Welcome Call intake workflow';
