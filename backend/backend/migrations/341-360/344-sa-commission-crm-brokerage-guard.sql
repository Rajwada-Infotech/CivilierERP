-- Guard against paying the same external deal introducer twice:
-- CRM brokerage is the Finance-approved broker payout path. SA commissions may
-- still carry internal salesperson/team-lead incentives, but channel-partner
-- payouts are blocked when CRM brokerage exists for the same booking.

IF OBJECT_ID('dbo.trg_SaCommission_BlockChannelPartnerWhenCrmBrokerage', 'TR') IS NOT NULL
  DROP TRIGGER dbo.trg_SaCommission_BlockChannelPartnerWhenCrmBrokerage;
GO

CREATE TRIGGER dbo.trg_SaCommission_BlockChannelPartnerWhenCrmBrokerage
ON dbo.SaCommission
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM inserted i
    JOIN dbo.CrmBrokerageMaster br
      ON br.BookingId = i.BookingId
    WHERE i.BookingId IS NOT NULL
      AND (i.ChannelPartnerId IS NOT NULL OR ISNULL(i.CpAmount, 0) > 0)
  )
  BEGIN
    THROW 51074, 'CRM brokerage already exists for this booking; channel-partner payout must use the CRM brokerage Finance-payment flow.', 1;
  END;
END;
GO
