-- External/channel-partner payouts now belong to CRM Brokerage -> Finance
-- Payment. SA Commission remains only for internal salesperson/team-lead
-- incentives, so new/edited channel-partner payout rows are blocked.

IF OBJECT_ID('dbo.trg_SaCommission_BlockChannelPartnerPayout', 'TR') IS NOT NULL
  DROP TRIGGER dbo.trg_SaCommission_BlockChannelPartnerPayout;
GO

CREATE TRIGGER dbo.trg_SaCommission_BlockChannelPartnerPayout
ON dbo.SaCommission
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM inserted i
    WHERE i.ChannelPartnerId IS NOT NULL
       OR ISNULL(i.CpRate, 0) > 0
       OR ISNULL(i.CpAmount, 0) > 0
  )
  BEGIN
    THROW 51075, 'Channel partner payouts must be handled through CRM Brokerage, not SA Commissions.', 1;
  END;
END;
GO
