-- Migration 449: detach CRM Customer ledger heads from the general
-- Customer Master.
--
-- crmLedger.js's ensureCrmCustomerLedgerHead() eagerly creates an
-- AccountHeadMaster row (LHeadCode 'CRMCUST-<id>') for every CrmCustomer so
-- GL posting (money receipts, refunds, on-account, held credit) has a
-- ledger head to post against. It has always minted these as LHeadType='A'
-- (migration 224 moved it there from 'C', to fix a collision with
-- Contractor) — 'A' is also the exact type dbo/CustomerMaster.tsx uses for
-- Finance's general Customer Master (any party the business invoices —
-- scrap sales, material sales, anything outside CRM). That collision meant
-- every CRM flat-buyer silently showed up in Finance's general customer
-- list the moment they were created.
--
-- These are legitimately different concepts (business decision, 2026-09-22):
-- Customer Master = any invoiceable party across the whole ERP.
-- CRM Customer = specifically someone buying a flat through CRM.
-- They need to be fully independent, non-overlapping lists.
--
-- Fix: CRM customer heads now mint as LHeadType='RC' (crmLedger.js, same
-- migration set). This converts the existing CRMCUST-prefixed rows to
-- match, mirroring migration 224's exact pattern.
--
-- Trial Balance / financial-statement inclusion is driven by LBelongsTo
-- (the Sundry Debtors account group), not by LHeadType — see
-- trialBalance.js's isReceivablesGroup(). So this migration only changes
-- which UI list these rows appear in; GL posting and receivables reporting
-- are unaffected.
UPDATE dbo.AccountHeadMaster
SET LHeadType = 'RC'
WHERE LHeadCode LIKE 'CRMCUST-%'
  AND LHeadType = 'A';

PRINT 'Converted ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' CRM customer head(s) from LHeadType=''A'' to ''RC'' — detached from the general Customer Master.';
