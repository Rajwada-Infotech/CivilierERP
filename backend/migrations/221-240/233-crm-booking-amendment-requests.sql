-- Once an Agreement's documents are actually being verified (at least one
-- CrmAgreementDocument uploaded), Unit/Parking/Extra-Charge changes on the
-- booking can no longer apply directly — the numbers may already be baked
-- into a document someone is reviewing/signing. This table queues the
-- change as a pending amendment instead, requiring the same approver set
-- crm-bookings already uses (admin/super_admin/marketing_head) before it
-- applies for real.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBookingAmendmentRequest' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBookingAmendmentRequest (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BookingId       INT             NOT NULL REFERENCES dbo.CrmBooking(Id),
    -- ChangeType: ExtraCharge / ParkingAllotment
    ChangeType      NVARCHAR(30)    NOT NULL,
    -- Action: Add / Edit / Release
    Action          NVARCHAR(20)    NOT NULL,
    -- TargetId: the ExtraCharge/ParkingAllotment row being touched (NULL for a new Add)
    TargetId        INT             NULL,
    -- ProposedChange: JSON snapshot of the request body to apply on approval
    ProposedChange  NVARCHAR(MAX)   NOT NULL,
    Reason          NVARCHAR(500)   NOT NULL,
    -- Status: Pending / Approved / Rejected
    Status          NVARCHAR(20)    NOT NULL DEFAULT 'Pending',
    RequestedBy     INT             NULL,
    RequestedAt     DATETIME2(3)    NOT NULL DEFAULT SYSDATETIME(),
    ReviewedBy      INT             NULL,
    ReviewedAt      DATETIME2(3)    NULL,
    ReviewNotes     NVARCHAR(500)   NULL
  );
  PRINT 'Created dbo.CrmBookingAmendmentRequest';
END
GO
