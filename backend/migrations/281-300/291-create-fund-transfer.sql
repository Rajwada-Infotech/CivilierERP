-- Migration 291: Fund Transfer (intra-company and inter-company bank-to-bank
-- cash movement).
--
-- Intra-company: money moves between two bank accounts of the SAME company
-- -- a plain 2-leg GL voucher (Dr destination bank, Cr source bank).
--
-- Inter-company: money moves from one company's bank account to a DIFFERENT
-- company's bank account. Per accounting rules this is booked as an
-- inter-company LOAN, not a trade transaction. One shared "Inter-Company
-- Loan" ledger head is auto-created per counterparty COMPANY PAIR (see
-- resolveOrCreateLoanHead() in generalLedger.js) and reused for every future
-- transfer between that pair, in either direction:
--   Source company's books (companyId = SourceCompanyId):
--     Dr Inter-Company Loan (the pair's shared head) -- receivable
--     Cr Source Bank
--   Destination company's books (companyId = DestinationCompanyId):
--     Dr Destination Bank
--     Cr Inter-Company Loan (the SAME shared head)   -- payable
-- Two independent, separately-balanced vouchers are posted (one per
-- company) because each company's own books must balance on their own --
-- Trial Balance filters GeneralLedgerEntry by CompanyId, so the same head
-- correctly nets to a receivable in one company's filtered view and a
-- payable in the other's, and nets to ~zero in a consolidated (no company
-- filter) view -- exactly the right behaviour for an inter-company
-- elimination. A reverse-direction transfer later (repayment) posts against
-- the SAME head with the legs flipped, so the running loan balance nets
-- down naturally -- no separate "repayment" mode needed.
--
-- Goes through the same Draft -> Pending -> Approved workflow as every other
-- money-moving voucher (approvalService.js) -- GL only posts on full
-- approval, restricted to super_admin (MODULE_APPROVER_ROLE_OVERRIDES),
-- matching Journal Voucher / Inter-Company (Stock) Transfer.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'FundTransfer'
)
BEGIN
  CREATE TABLE dbo.FundTransfer (
    FTId                  INT IDENTITY(1,1) PRIMARY KEY,
    DocNo                 NVARCHAR(100)  NULL,
    TransferDate          DATE           NOT NULL,
    TransferType          NVARCHAR(20)   NOT NULL CONSTRAINT CK_FT_Type CHECK (TransferType IN ('Intra','Inter')),
    SourceCompanyId       INT            NOT NULL,
    DestinationCompanyId  INT            NOT NULL,
    SourceBankId          INT            NOT NULL,
    DestinationBankId     INT            NOT NULL,
    Amount                DECIMAL(18,2)  NOT NULL CONSTRAINT CK_FT_Amount CHECK (Amount > 0),
    Narration             NVARCHAR(500)  NULL,
    LoanHeadId            INT            NULL,
    Status                NVARCHAR(20)   NOT NULL CONSTRAINT DF_FT_Status DEFAULT 'Draft',
    DocTypeId             INT            NULL,
    CreatedBy             NVARCHAR(150)  NULL,
    CreatedAt              DATETIME2     NOT NULL CONSTRAINT DF_FT_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy              NVARCHAR(150) NULL,
    UpdatedAt               DATETIME2    NULL,
    CONSTRAINT CK_FT_DifferentBanks CHECK (SourceBankId <> DestinationBankId),
    CONSTRAINT CK_FT_CompanyConsistency CHECK (
      (TransferType = 'Intra' AND SourceCompanyId = DestinationCompanyId) OR
      (TransferType = 'Inter' AND SourceCompanyId <> DestinationCompanyId)
    ),
    CONSTRAINT FK_FT_SourceCompany FOREIGN KEY (SourceCompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_FT_DestCompany FOREIGN KEY (DestinationCompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_FT_SourceBank FOREIGN KEY (SourceBankId) REFERENCES dbo.AccountHeadMaster(LHeadId),
    CONSTRAINT FK_FT_DestBank FOREIGN KEY (DestinationBankId) REFERENCES dbo.AccountHeadMaster(LHeadId),
    CONSTRAINT FK_FT_LoanHead FOREIGN KEY (LoanHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId)
  );

  CREATE INDEX IX_FT_Status ON dbo.FundTransfer(Status);
  CREATE INDEX IX_FT_TransferDate ON dbo.FundTransfer(TransferDate);

  PRINT 'Created dbo.FundTransfer';
END
ELSE
  PRINT 'dbo.FundTransfer already exists — skipping create';
GO
