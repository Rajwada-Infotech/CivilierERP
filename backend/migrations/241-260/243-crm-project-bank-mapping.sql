-- New Setup page: which company bank account(s) a Project's payments should
-- be deposited into. "Bank Master" (bankMaster.js) is a filtered view of
-- dbo.AccountHeadMaster (Group='BNK') — BankLHeadId here is that same
-- AccountHeadMaster.LHeadId. A project can link multiple banks (staff picks
-- among just that project's banks at payment time); zero links means every
-- payment surface falls back to the full bank list.
CREATE TABLE dbo.CrmProjectBank (
  Id           INT IDENTITY(1,1) PRIMARY KEY,
  ProjectId    INT NOT NULL,
  BankLHeadId  INT NOT NULL,
  IsActive     BIT NOT NULL DEFAULT 1,
  CreatedBy    INT NULL,
  CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
);

CREATE UNIQUE INDEX UQ_CrmProjectBank_Project_Bank
  ON dbo.CrmProjectBank (ProjectId, BankLHeadId)
  WHERE IsActive = 1;
