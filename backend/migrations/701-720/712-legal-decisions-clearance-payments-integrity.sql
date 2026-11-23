-- Legal: records the business review asked for.
-- 1. LegalLandDecision — every approval decision is its own row, never edited or deleted: Land approval
--    (Approve / Send back), Deed approval (Approve / Hold / Reject), Amendment (Approve / Reject), with reason and time.
-- 2. Version integrity — each frozen version keeps a SHA-256 hash of its snapshot; each submission for verification keeps
--    the exact data sent (SubmissionJson) and its hash.
-- 3. LA & ULC — full status path (Not Applicable, Application Submitted, Under Review, Query Raised, Query Replied,
--    Approved, Rejected, Expired), expiry date, and an event history (LegalLandClearanceEvent).
-- 4. Payments — PaymentStatus (Cleared / Pending / Failed / Refunded / Reversed) and ReversalOfId: a wrong payment is
--    corrected by a reversal entry, its history is not overwritten.
-- 5. Post-registration tasks — assigned user, completed by / at.
IF OBJECT_ID('dbo.LegalLandDecision', 'U') IS NULL
  CREATE TABLE dbo.LegalLandDecision (
    DecisionId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalLandDecision PRIMARY KEY,
    LandId      INT NOT NULL CONSTRAINT FK_LegalLandDecision_Land REFERENCES dbo.LegalLand (LandId),
    Stage       NVARCHAR(30) NOT NULL,     -- Land approval / Deed approval / Amendment
    Action      NVARCHAR(30) NOT NULL,     -- Approve / Send back / Hold / Reject
    VersionNo   INT NULL,
    Reason      NVARCHAR(1000) NULL,
    DecidedBy   INT NULL,
    DecidedAt   DATETIME2 NOT NULL CONSTRAINT DF_LegalLandDecision_At DEFAULT SYSUTCDATETIME()
  );
GO
IF COL_LENGTH('dbo.LegalLandRegisterSnapshot', 'SnapshotHash') IS NULL ALTER TABLE dbo.LegalLandRegisterSnapshot ADD SnapshotHash NVARCHAR(64) NULL;
IF COL_LENGTH('dbo.LegalLandReview', 'SubmissionJson') IS NULL ALTER TABLE dbo.LegalLandReview ADD SubmissionJson NVARCHAR(MAX) NULL, SubmissionHash NVARCHAR(64) NULL;
IF COL_LENGTH('dbo.LegalLandClearance', 'ExpiryDate') IS NULL ALTER TABLE dbo.LegalLandClearance ADD ExpiryDate DATE NULL;
IF COL_LENGTH('dbo.LegalPayment', 'PaymentStatus') IS NULL ALTER TABLE dbo.LegalPayment ADD PaymentStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalPayment_Status DEFAULT N'Cleared', ReversalOfId INT NULL;
IF COL_LENGTH('dbo.LegalPostRegTask', 'AssignedUserId') IS NULL ALTER TABLE dbo.LegalPostRegTask ADD AssignedUserId INT NULL, CompletedBy INT NULL, CompletedAt DATETIME2 NULL, AlertOn DATE NULL;
GO
IF OBJECT_ID('dbo.LegalLandClearanceEvent', 'U') IS NULL
  CREATE TABLE dbo.LegalLandClearanceEvent (
    EventId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalLandClearanceEvent PRIMARY KEY,
    LandId    INT NOT NULL,
    Kind      NVARCHAR(10) NOT NULL,
    Status    NVARCHAR(30) NOT NULL,
    EventDate DATE NULL,
    RefNo     NVARCHAR(100) NULL,
    Remarks   NVARCHAR(1000) NULL,
    FileId    INT NULL,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandClearanceEvent_At DEFAULT SYSUTCDATETIME()
  );
GO
-- Clearance statuses: the old names become the new ones.
UPDATE dbo.LegalLandClearance SET Status = CASE Status WHEN N'Applied' THEN N'Application Submitted' WHEN N'Under Processing' THEN N'Under Review' WHEN N'Obtained' THEN N'Approved' ELSE Status END
WHERE Status IN (N'Applied', N'Under Processing', N'Obtained');
GO
