-- Migration 625: amendment requests for approved documents (the universal amendment logic).
-- An amendment is a proposed new version of an approved document (first: a Purchase Order) with a mandatory reason.
-- It waits for approval like any other record (Approval Inbox module "doc-amendment"); only once fully approved is it
-- applied — the document is updated and the change cascades down its chain (a PO's GRNs are revalued, their ledger
-- postings reversed and re-posted). The existing edit path and its guards are untouched.
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocAmendment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DocAmendment (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    DocType       NVARCHAR(40)   NOT NULL,          -- 'purchase-order' (more document types plug in later)
    DocId         INT            NOT NULL,
    DocNo         NVARCHAR(100)  NULL,
    Module        NVARCHAR(20)   NOT NULL,          -- which Amendment page lists it: 'material', ...
    ProjectId     INT            NULL,
    CompanyId     INT            NULL,
    Status        NVARCHAR(20)   NOT NULL CONSTRAINT DF_DocAmendment_Status DEFAULT 'Draft', -- Draft (just raised) | Pending | Approved | Rejected
    Reason        NVARCHAR(2000) NOT NULL,
    BeforeJson    NVARCHAR(MAX)  NOT NULL,          -- the document as it was when the amendment was raised
    ProposedJson  NVARCHAR(MAX)  NOT NULL,          -- the amended document
    CascadeJson   NVARCHAR(MAX)  NULL,              -- downstream documents and their old -> new values (preview)
    OldValue      DECIMAL(18,2)  NULL,
    NewValue      DECIMAL(18,2)  NULL,
    RequestedBy   NVARCHAR(150)  NOT NULL,
    RequesterJson NVARCHAR(1000) NULL,              -- who raised it (id, role): an amendment applied by running the document's own edit runs it as them
    RequestedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_DocAmendment_RequestedAt DEFAULT SYSDATETIME(),
    DecidedBy     NVARCHAR(150)  NULL,
    DecidedAt     DATETIME2(3)   NULL,
    AppliedAt     DATETIME2(3)   NULL,
    ApplyError    NVARCHAR(2000) NULL,              -- set when approval succeeded but applying it failed
    RejectionNote NVARCHAR(1000) NULL
  );
  CREATE INDEX IX_DocAmendment_Doc ON dbo.DocAmendment (DocType, DocId);
  CREATE INDEX IX_DocAmendment_Status ON dbo.DocAmendment (Status, Module);
END
GO

PRINT 'Migration 625: dbo.DocAmendment.';
GO
