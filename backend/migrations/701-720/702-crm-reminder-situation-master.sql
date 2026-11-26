-- Reminder situations are setup data, not front-end constants.  The engine owns
-- the safe business evaluators for each key; this master owns what users see,
-- which dates/fields a rule may use, and where a customer reminder opens.
IF OBJECT_ID('dbo.CrmReminderSituation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderSituation (
    Situation NVARCHAR(50) NOT NULL CONSTRAINT PK_CrmReminderSituation PRIMARY KEY,
    Label NVARCHAR(150) NOT NULL,
    Description NVARCHAR(500) NOT NULL,
    StartsJson NVARCHAR(200) NOT NULL,
    FieldsJson NVARCHAR(1000) NOT NULL,
    CustomerScreen NVARCHAR(80) NULL,
    PortalTarget NVARCHAR(50) NULL,
    NotifyType NVARCHAR(80) NOT NULL,
    RefType NVARCHAR(80) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_CrmReminderSituation_Sort DEFAULT 0,
    IsActive BIT NOT NULL CONSTRAINT DF_CrmReminderSituation_Active DEFAULT 1,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmReminderSituation_Updated DEFAULT SYSDATETIME()
  );
END
GO

MERGE dbo.CrmReminderSituation AS target
USING (VALUES
 (N'bookingPayment', N'Booking payment not received', N'The booking''s first payment milestone is still to pay. It stops once the payment is covered or being verified.', N'["BookingDate"]', N'["CustomerName","BookingNo","Project","Unit","StartDate","DaysSinceStart","Milestone","Amount","DueDate"]', N'CustomerPayments', N'payments', N'crm_reminder_booking_payment', N'payment_milestone', 10),
 (N'instalmentDue', N'Payment milestone due or overdue', N'Any customer payment milestone with money still to pay. It stops once the payment is covered or being verified.', N'["DueDate","DemandDate"]', N'["CustomerName","BookingNo","Project","Unit","StartDate","DaysSinceStart","Milestone","Amount","DueDate"]', N'CustomerPayments', N'payments', N'sla_payment_overdue', N'payment_milestone', 20),
 (N'agreementPending', N'Agreement not signed', N'The booking has no executed or registered agreement. It stops once the agreement is executed.', N'["BookingDate"]', N'["CustomerName","BookingNo","Project","Unit","StartDate","DaysSinceStart"]', N'CustomerDocuments', N'documents', N'crm_reminder_agreement', N'crm_booking', 30)
) AS source (Situation, Label, Description, StartsJson, FieldsJson, CustomerScreen, PortalTarget, NotifyType, RefType, SortOrder)
ON target.Situation = source.Situation
WHEN NOT MATCHED THEN INSERT (Situation, Label, Description, StartsJson, FieldsJson, CustomerScreen, PortalTarget, NotifyType, RefType, SortOrder)
VALUES (source.Situation, source.Label, source.Description, source.StartsJson, source.FieldsJson, source.CustomerScreen, source.PortalTarget, source.NotifyType, source.RefType, source.SortOrder);
GO
