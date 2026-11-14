-- Migration 656: the Unit Change request.
--
-- A buyer moves from one unit to another (same project or another one). The request is raised with the new unit, its
-- rate and plan, and a choice for each parking slot and extra charge (keep it or change it); Approval Setup's
-- "CRM Unit Change" approves it. On approval the old booking closes as UnitChanged, a new booking opens on the new unit
-- for the same buyer, and every rupee received moves to it in full (no charge). A move between companies waits for its
-- Fund Transfer approval (Status MovingMoney). Safe to run again.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPropertyChangeRequest' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPropertyChangeRequest (
    Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmPropertyChangeRequest PRIMARY KEY,
    RequestNo NVARCHAR(30) NULL,
    SourceBookingId INT NOT NULL REFERENCES dbo.CrmBooking(Id),
    SourceApplicationId INT NOT NULL REFERENCES dbo.CrmApplication(Id),
    TargetApplicationId INT NULL REFERENCES dbo.CrmApplication(Id),
    TargetBookingId INT NULL REFERENCES dbo.CrmBooking(Id),
    SourceUnitId INT NULL REFERENCES dbo.UnitMaster(Id),
    TargetUnitId INT NOT NULL REFERENCES dbo.UnitMaster(Id),
    SourceProjectId INT NULL,
    TargetProjectId INT NULL,
    SourceCompanyId INT NULL,
    TargetCompanyId INT NULL,
    RatePerSqFt DECIMAL(18,4) NULL,
    PaymentPlanId INT NULL,
    -- What happens to each parking slot and extra charge of the old booking: [{"kind":"Parking"|"ExtraCharge","id":..,"keep":true|false}]
    AddOnsJson NVARCHAR(MAX) NULL,
    SourceGrandTotalAtRequest DECIMAL(18,2) NULL,
    TargetEstimateAtRequest DECIMAL(18,2) NULL,
    ClearedAtRequest DECIMAL(18,2) NULL,
    AvailableCreditAtRequest DECIMAL(18,2) NULL,
    HeldCreditAtRequest DECIMAL(18,2) NULL,
    PendingFinanceAtRequest DECIMAL(18,2) NULL,
    PendingCrmReceiptAtRequest DECIMAL(18,2) NULL,
    ContractualDueAtRequest DECIMAL(18,2) NULL,
    Reason NVARCHAR(1000) NOT NULL,
    Status NVARCHAR(40) NOT NULL CONSTRAINT DF_CrmPropertyChangeRequest_Status DEFAULT N'Pending',
    -- What the approval did or what stopped it (a failed step is retried from the request).
    Note NVARCHAR(1000) NULL,
    MovedAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_CrmPropertyChangeRequest_MovedAmount DEFAULT 0,
    CreditCarriedAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_CrmPropertyChangeRequest_CreditCarriedAmount DEFAULT 0,
    ApprovedBy INT NULL,
    ApprovedAt DATETIME2(3) NULL,
    CreatedBy INT NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CrmPropertyChangeRequest_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2(3) NULL,
    CompletedAt DATETIME2(3) NULL
  );
  CREATE UNIQUE INDEX UX_CrmPropertyChangeRequest_No ON dbo.CrmPropertyChangeRequest(RequestNo) WHERE RequestNo IS NOT NULL;
  CREATE INDEX IX_CrmPropertyChangeRequest_Source ON dbo.CrmPropertyChangeRequest(SourceBookingId, Status);
  CREATE INDEX IX_CrmPropertyChangeRequest_TargetApp ON dbo.CrmPropertyChangeRequest(TargetApplicationId) WHERE TargetApplicationId IS NOT NULL;
  CREATE INDEX IX_CrmPropertyChangeRequest_TargetBooking ON dbo.CrmPropertyChangeRequest(TargetBookingId) WHERE TargetBookingId IS NOT NULL;
  -- One open request per booking.
  CREATE UNIQUE INDEX UX_CrmPropertyChangeRequest_OpenSource ON dbo.CrmPropertyChangeRequest(SourceBookingId)
    WHERE Status IN (N'Pending', N'Approved', N'MovingMoney', N'Failed');
END
GO

-- The old booking points at the request that closed it.
IF COL_LENGTH('dbo.CrmBooking', 'ClosedByUnitChangeId') IS NULL
  ALTER TABLE dbo.CrmBooking ADD ClosedByUnitChangeId INT NULL;
GO

PRINT 'Migration 656 complete: CRM Unit Change request';
