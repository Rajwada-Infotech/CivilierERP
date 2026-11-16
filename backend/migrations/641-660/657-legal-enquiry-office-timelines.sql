-- 657: Deed Registry Search per registration office. When an enquiry is saved it gets one timeline for EVERY office
-- type (ADSR, DSR, RA Calcutta, BLRO), each due = enquiry date + that office's time limit. Per office the user records
-- what was found year by year (1956 → this year) and then marks that office's search complete. An office still open past
-- its due date is overdue (dashboard warning + notification). Schema; existing enquiries get their office rows from
-- their own enquiry date (derived, not sample data).
IF OBJECT_ID('dbo.LegalEnquiryOfficeSearch', 'U') IS NULL
CREATE TABLE dbo.LegalEnquiryOfficeSearch (
  OfficeSearchId INT IDENTITY(1,1) CONSTRAINT PK_LegalEnquiryOfficeSearch PRIMARY KEY,
  EnquiryId     INT NOT NULL CONSTRAINT FK_LegalEnquiryOfficeSearch_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId) ON DELETE CASCADE,
  OfficeType    NVARCHAR(60) NOT NULL,
  OfficeId      INT NULL CONSTRAINT FK_LegalEnquiryOfficeSearch_Office REFERENCES dbo.LegalRegistrationOffice (OfficeId),
  SlaDays       INT NOT NULL,
  DueDate       DATE NOT NULL,
  Status        NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalEnquiryOfficeSearch_Status DEFAULT N'Pending'
                CONSTRAINT CK_LegalEnquiryOfficeSearch_Status CHECK (Status IN (N'Pending', N'Completed')),
  Remarks       NVARCHAR(1000) NULL,
  CompletedBy   INT NULL,
  CompletedAt   DATETIME2 NULL,
  AlertOn       DATE NULL,
  CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_LegalEnquiryOfficeSearch_At DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_LegalEnquiryOfficeSearch UNIQUE (EnquiryId, OfficeType)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalEnquiryOfficeSearch_Due')
  CREATE INDEX IX_LegalEnquiryOfficeSearch_Due ON dbo.LegalEnquiryOfficeSearch (Status, DueDate);
GO
INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeType, SlaDays, DueDate)
SELECT e.EnquiryId, s.OfficeType, s.Days, DATEADD(day, s.Days, e.EnquiryDate)
FROM dbo.LegalLandEnquiry e CROSS JOIN dbo.LegalRegistryOfficeSla s
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch x WHERE x.EnquiryId = e.EnquiryId AND x.OfficeType = s.OfficeType);
GO
-- Year results already recorded complete nothing by themselves; an office already holding a result for a converted
-- enquiry is treated as done.
UPDATE o SET Status = N'Completed', CompletedAt = SYSUTCDATETIME()
FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId
WHERE e.LandId IS NOT NULL AND o.Status = N'Pending';
GO
