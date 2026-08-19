-- 336: Labour/Material "given by" becomes a real entity, not just a
-- CONTRACTOR/DEVELOPER label — when the source is CONTRACTOR, these hold
-- which contractor (dbo.AccountHeadMaster.LHeadId, LHeadType='C'), scoped
-- in the UI to contractors already allocated to the chain's own project
-- (dbo.ContractorAllocation). No hard FK to AccountHeadMaster — the rest of
-- this codebase (see ContractorAllocation.ContractorLHeadId) doesn't
-- enforce one either, since AccountHeadMaster spans every ledger type, not
-- just contractors.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'LabourContractorId')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD
    LabourContractorId   INT NULL,
    MaterialContractorId INT NULL;
END
GO
