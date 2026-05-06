CREATE TABLE MaterialIssues (
    IssueId INT IDENTITY(1,1) PRIMARY KEY,
    IssueNo VARCHAR(50) NOT NULL UNIQUE,
    CompanyId INT NOT NULL,
    ProjectId INT NOT NULL,
    Date DATE NOT NULL,
    ItemId VARCHAR(100) NOT NULL,
    UOMId VARCHAR(50) NULL,
    Quantity DECIMAL(18,2) NOT NULL CHECK (Quantity > 0),
    Remarks NVARCHAR(MAX) NULL,
    Reason NVARCHAR(MAX) NOT NULL,
    Status VARCHAR(20) DEFAULT 'Draft',
    CreatedBy INT NULL,
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE()
);

CREATE INDEX IX_MaterialIssues_CompanyId ON MaterialIssues(CompanyId);
CREATE INDEX IX_MaterialIssues_ProjectId ON MaterialIssues(ProjectId);
CREATE INDEX IX_MaterialIssues_ItemId ON MaterialIssues(ItemId);