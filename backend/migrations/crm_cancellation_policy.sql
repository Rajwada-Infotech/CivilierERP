-- ============================================================
-- Migration: CrmCancellationPolicy — per-project penalty slabs
-- Run once on the CivilierERP database.
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables WHERE name = 'CrmCancellationPolicy' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
    CREATE TABLE dbo.CrmCancellationPolicy (
        Id                   INT            IDENTITY(1,1) PRIMARY KEY,
        ProjectId            INT            NULL REFERENCES dbo.enterprise(id),
        PolicyName           NVARCHAR(200)  NOT NULL DEFAULT 'Standard Cancellation Policy',
        DaysFromBookingMin   INT            NOT NULL DEFAULT 0,
        DaysFromBookingMax   INT            NULL,
        DeductionPercent     DECIMAL(5,2)   NOT NULL,
        Notes                NVARCHAR(500)  NULL,
        IsActive             BIT            NOT NULL DEFAULT 1,
        CreatedBy            INT            NULL REFERENCES dbo.Users(id),
        CreatedAt            DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt            DATETIME2(3)   NULL
    );
    CREATE UNIQUE INDEX UX_CrmCancellationPolicy_Slab
        ON dbo.CrmCancellationPolicy (ProjectId, DaysFromBookingMin)
        WHERE IsActive = 1;
    PRINT 'Created dbo.CrmCancellationPolicy';
END
ELSE
    PRINT 'dbo.CrmCancellationPolicy already exists — skipped';
GO
IF NOT EXISTS (SELECT 1 FROM dbo.CrmCancellationPolicy WHERE ProjectId IS NULL AND IsActive = 1)
BEGIN
    INSERT INTO dbo.CrmCancellationPolicy (ProjectId, PolicyName, DaysFromBookingMin, DaysFromBookingMax, DeductionPercent, Notes)
    VALUES
        (NULL, 'Global Default',  0,  30,   5.00, 'Cancelled within 30 days of booking — 5% charge'),
        (NULL, 'Global Default', 31,  90,  10.00, 'Cancelled 31-90 days after booking — 10% charge'),
        (NULL, 'Global Default', 91, NULL, 20.00, 'Cancelled more than 90 days after booking — 20% charge');
    PRINT 'Seeded global default cancellation policy slabs';
END
GO
