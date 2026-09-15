-- Migration 432: Offer Letter & Joining (HR and Payroll module) — issued
-- once a candidate's Interview Result is "Selected" (see CandidateMaster.
-- InterviewStatus / the Interview page's status sync). One row per offer;
-- ActualDateOfJoining/JoiningRemarks are filled in later from the same
-- row's Joining tab rather than a separate table, per the "just confirm
-- the actual join date" scope.

IF OBJECT_ID('dbo.OfferLetter', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OfferLetter (
    OfferId               INT            IDENTITY(1,1) PRIMARY KEY,
    DocNo                 NVARCHAR(30)   NOT NULL,
    CandidateId            INT            NOT NULL,
    CompanyId              INT            NULL,
    FinYearId              INT            NULL,
    Salary                 DECIMAL(12,2)  NULL,
    CandidateAddress       NVARCHAR(500)  NULL,
    DateOfJoin             DATE           NULL,
    DocumentDate           DATE           NOT NULL,
    Remarks                NVARCHAR(1000) NULL,
    JoiningConfirmed        BIT            NOT NULL CONSTRAINT DF_OfferLetter_JoiningConfirmed DEFAULT 0,
    ActualDateOfJoining     DATE           NULL,
    JoiningRemarks          NVARCHAR(500)  NULL,
    IsActive               BIT            NOT NULL CONSTRAINT DF_OfferLetter_IsActive DEFAULT 1,
    CreatedBy              INT            NULL,
    CreatedAt              DATETIME2      NOT NULL CONSTRAINT DF_OfferLetter_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy              INT            NULL,
    UpdatedAt              DATETIME2      NULL,

    CONSTRAINT UQ_OfferLetter_DocNo UNIQUE (DocNo),
    CONSTRAINT FK_OfferLetter_Candidate FOREIGN KEY (CandidateId) REFERENCES dbo.CandidateMaster(CandidateId),
    CONSTRAINT FK_OfferLetter_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_OfferLetter_FinYear FOREIGN KEY (FinYearId) REFERENCES dbo.FinYear(FId),
    CONSTRAINT FK_OfferLetter_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_OfferLetter_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_OfferLetter_CandidateId ON dbo.OfferLetter(CandidateId);
  CREATE INDEX IX_OfferLetter_CompanyId ON dbo.OfferLetter(CompanyId);
  CREATE INDEX IX_OfferLetter_FinYearId ON dbo.OfferLetter(FinYearId);
END
GO

-- New page: "Offer Letter & Joining" — a main HR transaction page (not a
-- Setup master), reachable from the HR and Payroll sidebar's HR section.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'offer-letter-joining')
  UPDATE dbo.PageDefinitions
    SET Label = N'Offer Letter & Joining', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'offer-letter-joining';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'offer-letter-joining', N'Offer Letter & Joining', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete,print,export', 20, 1, N'migration-432', SYSDATETIME());
GO

PRINT '432-offer-letter applied successfully.';
GO
