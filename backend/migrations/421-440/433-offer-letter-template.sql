-- Migration 433: Offer Letter Template — a single-row body template with
-- {{Placeholder}} tokens, editable from the "Letter Body" tab and merged
-- with an offer's data when generating/printing that offer letter.

IF OBJECT_ID('dbo.OfferLetterTemplate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OfferLetterTemplate (
    TemplateId  INT            IDENTITY(1,1) PRIMARY KEY,
    Body        NVARCHAR(MAX)  NOT NULL,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_OfferLetterTemplate_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy   INT            NULL,
    UpdatedAt   DATETIME2      NULL,

    CONSTRAINT FK_OfferLetterTemplate_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );

  INSERT INTO dbo.OfferLetterTemplate (Body) VALUES (N'Dear {{CandidateName}},

We are pleased to offer you the position at {{Company}}.

Your annual salary will be {{Salary}} and your proposed date of joining is {{DateOfJoin}}.

Address on file: {{CandidateAddress}}

This offer is issued as document {{DocNo}} dated {{DocumentDate}}, for financial year {{FinYear}}.

We look forward to welcoming you to the team.

Regards,
{{Company}}');
END
GO

PRINT '433-offer-letter-template applied successfully.';
GO
