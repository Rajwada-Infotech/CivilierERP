-- Migration 629: waiving a payment milestone goes through Approval Setup, and can be reversed.
--
-- Until now a waiver applied at once, for any amount, with no second person and no record beyond the milestone's own
-- Remarks. Now it is a request (workflow 'crm-milestone-waiver'); the milestone stays due until it is approved. Reversing
-- an approved waiver is a second gate on the same row (workflow 'crm-milestone-waiver-reversal').
--
-- A waiver holds no money of its own and posts nothing: it is a discount given before the amount is invoiced, so the
-- invoice simply bills less. A milestone that is already invoiced takes a credit note instead.
--
-- Additive and safe to run again. Existing waived milestones get an Approved row carrying what they already record.
IF OBJECT_ID('dbo.CrmMilestoneWaiver', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmMilestoneWaiver (
    Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmMilestoneWaiver PRIMARY KEY,
    BookingId INT NOT NULL,
    MilestoneId INT NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,          -- what the customer no longer owes on the milestone
    TaxableValue DECIMAL(18,2) NULL,
    GstAmount DECIMAL(18,2) NULL,
    Reason NVARCHAR(500) NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmMilestoneWaiver_Status DEFAULT N'Draft',  -- Draft | Pending | Approved | Rejected
    RequestedById INT NULL,
    RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmMilestoneWaiver_RequestedAt DEFAULT SYSDATETIME(),
    DecidedById INT NULL,
    DecidedAt DATETIME2 NULL,
    RejectionNote NVARCHAR(500) NULL,
    ReversalStatus NVARCHAR(20) NULL,       -- Draft | Pending | Approved | Rejected
    ReversalReason NVARCHAR(500) NULL,
    ReversalRequestedById INT NULL,
    ReversalRequestedAt DATETIME2 NULL,
    ReversalDecidedById INT NULL,
    ReversalDecidedAt DATETIME2 NULL,
    ReversalRejectionNote NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmMilestoneWaiver_CreatedAt DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmMilestoneWaiver_Booking ON dbo.CrmMilestoneWaiver (BookingId);
  CREATE INDEX IX_CrmMilestoneWaiver_Milestone ON dbo.CrmMilestoneWaiver (MilestoneId);
  -- One waiver at a time on a milestone: a rejected or fully reversed one can be asked for again.
  CREATE UNIQUE INDEX UX_CrmMilestoneWaiver_Open ON dbo.CrmMilestoneWaiver (MilestoneId) WHERE Status IN (N'Draft', N'Pending');
END
GO

-- The waivers already applied, so they show and can be reversed like any other.
IF OBJECT_ID('dbo.CrmMilestoneWaiver', 'U') IS NOT NULL
BEGIN
  INSERT INTO dbo.CrmMilestoneWaiver (BookingId, MilestoneId, Amount, TaxableValue, GstAmount, Reason, Status, RequestedById, RequestedAt, DecidedById, DecidedAt)
  SELECT m.BookingId, m.Id, x.Amount,
         ROUND(x.Amount - x.Amount * r.Ratio, 2), ROUND(x.Amount * r.Ratio, 2),
         LEFT(LTRIM(RTRIM(ISNULL(NULLIF(m.Remarks, N''), N'Waived before approval was required'))), 500),
         N'Approved', m.UpdatedBy, ISNULL(m.UpdatedAt, m.CreatedAt), m.UpdatedBy, ISNULL(m.UpdatedAt, m.CreatedAt)
  FROM dbo.CrmPaymentMilestone m
  JOIN dbo.CrmBooking b ON b.Id = m.BookingId
  CROSS APPLY (SELECT CASE WHEN m.AmountDue > ISNULL(m.AmountPaid, 0) THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE 0 END AS Amount) x
  CROSS APPLY (SELECT CASE WHEN ISNULL(b.GrandTotal, 0) > 0 THEN ISNULL(b.TotalGstAmount, 0) / b.GrandTotal ELSE 0 END AS Ratio) r
  WHERE m.Status = N'Waived'
    AND NOT EXISTS (SELECT 1 FROM dbo.CrmMilestoneWaiver w WHERE w.MilestoneId = m.Id AND w.Status = N'Approved' AND ISNULL(w.ReversalStatus, N'') <> N'Approved');
END
GO

-- The workflows start from the refund approval (the same people sign off money the customer won't pay). Approval Setup
-- edits them separately.
IF OBJECT_ID('dbo.ApprovalWorkflows', 'U') IS NOT NULL
BEGIN
  DECLARE @pairs TABLE (NewModule NVARCHAR(100), Name NVARCHAR(200), Descr NVARCHAR(500));
  INSERT INTO @pairs VALUES
    (N'crm-milestone-waiver', N'CRM Milestone Waiver', N'Waiving what a customer owes on a payment milestone. Started from the refund approval.'),
    (N'crm-milestone-waiver-reversal', N'CRM Milestone Waiver — Reversal', N'Putting a waived milestone back as due. Started from the refund approval.');
  DECLARE @m NVARCHAR(100), @n NVARCHAR(200), @d NVARCHAR(500);
  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT NewModule, Name, Descr FROM @pairs;
  OPEN cur; FETCH NEXT FROM cur INTO @m, @n, @d;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE N'%"' + @m + N'"%')
    BEGIN
      INSERT INTO dbo.ApprovalWorkflows (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
      SELECT TOP 1 @n, N'CrmMilestoneWaiver', w.Levels, w.Approvers, N'Active', @d, N'migration-624', SYSDATETIME(), ISNULL(w.type, N'sequential'),
             N'["' + @m + N'"]', 1, ISNULL(w.LevelsJson, N'[]'), w.LevelsData
      FROM dbo.ApprovalWorkflows w WHERE w.modules LIKE N'%"crm-refunds"%' AND w.active = 1 ORDER BY w.Id;
      IF @@ROWCOUNT = 0 PRINT CONCAT('Migration 629: no crm-refunds workflow to start ', @m, ' from: set it up in Approval Setup.');
    END
    FETCH NEXT FROM cur INTO @m, @n, @d;
  END
  CLOSE cur; DEALLOCATE cur;
END
GO
