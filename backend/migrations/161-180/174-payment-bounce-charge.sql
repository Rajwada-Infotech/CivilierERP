-- Migration 174: Add BounceCharge column to NewPayment for cheque re-issue flow

IF COL_LENGTH('dbo.NewPayment', 'BounceCharge') IS NULL
  ALTER TABLE dbo.NewPayment ADD BounceCharge DECIMAL(18,2) NULL;
