"use strict";
/**
 * Seed demo GRN + On-Account smoke data for supplier1@demo.com
 * (Demo Steel Suppliers Pvt Ltd, LHeadId 74) — exercises the "Received by
 * Customer" GRN tracking feature (partial + fully-received orders) and the
 * On Account Balance / Adjustment feature (a materialized credit balance
 * plus other outstanding invoices to adjust it against).
 *
 * Run: node backend/scripts/seedSupplierDemoGrnAndOA.js
 */
require("../config/env").loadEnv();
const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || "1433"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const SUPPLIER_ID = 74; // Demo Steel Suppliers Pvt Ltd (supplier1@demo.com)
const COMPANY_ID = 2;
const PROJECT_ID = 3;
const FIN_YEAR = "FY 2026-27";
const DOC_TYPE_ID = 15; // matches existing INV doc type used in-app

async function run() {
  const pool = await sql.connect(config);
  console.log("Connected to DB");

  // ── 1. GRN demo — partial receipt (100 ordered, 80 received) ─────────────
  const poA = await pool.request()
    .input("PurchaseOrderNo", sql.NVarChar(100), "SMOKE-PO-GRN-PARTIAL-01")
    .input("SupplierID", sql.Int, SUPPLIER_ID)
    .input("CompanyId", sql.Int, COMPANY_ID)
    .input("ProjectId", sql.Int, PROJECT_ID)
    .input("ItemDescription", sql.NVarChar(500), "Sand — river sand, coarse grade")
    .input("Quantity", sql.Decimal(18, 2), 100)
    .input("Unit", sql.NVarChar(50), "Bags")
    .input("Rate", sql.Decimal(18, 2), 350)
    .input("TotalAmount", sql.Decimal(18, 2), 41300) // 35000 + 18% GST
    .input("SubtotalAmount", sql.Decimal(18, 2), 35000)
    .query(`
      INSERT INTO dbo.PurchaseOrders (
        PurchaseOrderNo, DocNo, PODate, ExpectedDeliveryDate, SupplierID,
        CompanyId, ProjectId, ItemDescription, Quantity, Unit, Rate,
        TotalAmount, SubtotalAmount, GstType, GstRate, PaymentTerms, Remarks,
        CreatedAt, CreatedBy, Status, DocTypeId, POType, SupplierAcknowledged
      )
      OUTPUT INSERTED.PurchaseOrderID
      VALUES (
        @PurchaseOrderNo, @PurchaseOrderNo, '2026-07-01', '2026-07-10', @SupplierID,
        @CompanyId, @ProjectId, @ItemDescription, @Quantity, @Unit, @Rate,
        @TotalAmount, @SubtotalAmount, 'CGST_SGST', 18, 'Net 30 days',
        'SMOKE TEST DATA — Received by Customer (partial) demo',
        SYSDATETIME(), 'smoke-seed', 'Received', ${DOC_TYPE_ID}, 'Direct', 1
      )
    `);
  const poAId = poA.recordset[0].PurchaseOrderID;

  await pool.request()
    .input("PurchaseOrderID", sql.Int, poAId)
    .input("ItemName", sql.NVarChar(200), "Sand")
    .input("Quantity", sql.Decimal(18, 2), 100)
    .input("ReceivedQty", sql.Decimal(18, 2), 80)
    .input("UomName", sql.NVarChar(50), "Bags")
    .input("Rate", sql.Decimal(18, 2), 350)
    .input("LineAmount", sql.Decimal(18, 2), 35000)
    .query(`
      INSERT INTO dbo.PurchaseOrderItems
        (PurchaseOrderID, ItemName, Quantity, ReceivedQty, UomName, Rate, LineAmount, SortOrder, CreatedAt)
      VALUES
        (@PurchaseOrderID, @ItemName, @Quantity, @ReceivedQty, @UomName, @Rate, @LineAmount, 0, SYSDATETIME())
    `);

  await pool.request()
    .input("GRNNo", sql.NVarChar(100), "SMOKE-GRN-PARTIAL-01")
    .input("SupplierID", sql.Int, SUPPLIER_ID)
    .input("POID", sql.Int, poAId)
    .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify([
      { itemId: null, itemName: "Sand", orderedQty: 100, receivedQty: 80, quantity: 80, uom: "Bags", rate: 350, totalAmount: 28000, amount: 28000 },
    ]))
    .input("TotalAmount", sql.Decimal(18, 2), 33040) // 28000 + 18% GST
    .query(`
      INSERT INTO dbo.GoodsReceiptNotes
        (GRNNo, DocNo, GRNDate, SupplierID, POID, GRNItems, Status, TotalAmount, Remarks, CreatedDate, DocTypeId)
      VALUES
        (@GRNNo, @GRNNo, '2026-07-08', @SupplierID, @POID, @GRNItems, 'Approved', @TotalAmount,
         'SMOKE TEST DATA — partial receipt (80 of 100 bags)', SYSDATETIME(), ${DOC_TYPE_ID})
    `);
  console.log(`PO A (partial, 80/100): PurchaseOrderID ${poAId}`);

  // ── 2. GRN demo — fully received (50 ordered, 50 received) ───────────────
  const poB = await pool.request()
    .input("PurchaseOrderNo", sql.NVarChar(100), "SMOKE-PO-GRN-FULL-01")
    .input("SupplierID", sql.Int, SUPPLIER_ID)
    .input("CompanyId", sql.Int, COMPANY_ID)
    .input("ProjectId", sql.Int, PROJECT_ID)
    .input("ItemDescription", sql.NVarChar(500), "Cement — OPC 53 grade, 50kg bags")
    .input("Quantity", sql.Decimal(18, 2), 50)
    .input("Unit", sql.NVarChar(50), "Bags")
    .input("Rate", sql.Decimal(18, 2), 420)
    .input("TotalAmount", sql.Decimal(18, 2), 24780) // 21000 + 18% GST
    .input("SubtotalAmount", sql.Decimal(18, 2), 21000)
    .query(`
      INSERT INTO dbo.PurchaseOrders (
        PurchaseOrderNo, DocNo, PODate, ExpectedDeliveryDate, SupplierID,
        CompanyId, ProjectId, ItemDescription, Quantity, Unit, Rate,
        TotalAmount, SubtotalAmount, GstType, GstRate, PaymentTerms, Remarks,
        CreatedAt, CreatedBy, Status, DocTypeId, POType, SupplierAcknowledged
      )
      OUTPUT INSERTED.PurchaseOrderID
      VALUES (
        @PurchaseOrderNo, @PurchaseOrderNo, '2026-06-25', '2026-07-02', @SupplierID,
        @CompanyId, @ProjectId, @ItemDescription, @Quantity, @Unit, @Rate,
        @TotalAmount, @SubtotalAmount, 'CGST_SGST', 18, 'Net 30 days',
        'SMOKE TEST DATA — Received by Customer (complete) demo',
        SYSDATETIME(), 'smoke-seed', 'Received', ${DOC_TYPE_ID}, 'Direct', 1
      )
    `);
  const poBId = poB.recordset[0].PurchaseOrderID;

  await pool.request()
    .input("PurchaseOrderID", sql.Int, poBId)
    .input("ItemName", sql.NVarChar(200), "Cement")
    .input("Quantity", sql.Decimal(18, 2), 50)
    .input("ReceivedQty", sql.Decimal(18, 2), 50)
    .input("UomName", sql.NVarChar(50), "Bags")
    .input("Rate", sql.Decimal(18, 2), 420)
    .input("LineAmount", sql.Decimal(18, 2), 21000)
    .query(`
      INSERT INTO dbo.PurchaseOrderItems
        (PurchaseOrderID, ItemName, Quantity, ReceivedQty, UomName, Rate, LineAmount, SortOrder, CreatedAt)
      VALUES
        (@PurchaseOrderID, @ItemName, @Quantity, @ReceivedQty, @UomName, @Rate, @LineAmount, 0, SYSDATETIME())
    `);

  await pool.request()
    .input("GRNNo", sql.NVarChar(100), "SMOKE-GRN-FULL-01")
    .input("SupplierID", sql.Int, SUPPLIER_ID)
    .input("POID", sql.Int, poBId)
    .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify([
      { itemId: null, itemName: "Cement", orderedQty: 50, receivedQty: 50, quantity: 50, uom: "Bags", rate: 420, totalAmount: 21000, amount: 21000 },
    ]))
    .input("TotalAmount", sql.Decimal(18, 2), 24780)
    .query(`
      INSERT INTO dbo.GoodsReceiptNotes
        (GRNNo, DocNo, GRNDate, SupplierID, POID, GRNItems, Status, TotalAmount, Remarks, CreatedDate, DocTypeId)
      VALUES
        (@GRNNo, @GRNNo, '2026-06-30', @SupplierID, @POID, @GRNItems, 'Approved', @TotalAmount,
         'SMOKE TEST DATA — fully received (50 of 50 bags)', SYSDATETIME(), ${DOC_TYPE_ID})
    `);
  console.log(`PO B (complete, 50/50): PurchaseOrderID ${poBId}`);

  // ── 3. On Account demo — an approved invoice + a materialized credit ─────
  const originatingEb = await pool.request()
    .input("EName", sql.NVarChar(200), "Payment for Demo Steel Suppliers Pvt Ltd")
    .input("EProjectName", sql.NVarChar(150), String(PROJECT_ID))
    .input("EDocumentType", sql.NVarChar(50), "TOD")
    .input("EDocDate", sql.Date, "2026-06-20")
    .input("EAmount", sql.Decimal(18, 2), 200000)
    .input("ENetAmount", sql.Decimal(18, 2), 200000)
    .input("EDocNo", sql.NVarChar(100), "SMOKE-INV-OA-ORIGIN-01")
    .input("ECompanyId", sql.Int, COMPANY_ID)
    .input("EFinYear", sql.NVarChar(20), FIN_YEAR)
    .input("LHeadId", sql.Int, SUPPLIER_ID)
    .query(`
      INSERT INTO dbo.ExpenseBooking (
        EName, EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
        EDocNo, EStatus, ECreatedAt, EUpdatedAt, ECompanyId, EFinYear,
        ESourceType, EPaymentType, EBillStatus, ETotalPaid, ERemainingAmount, LHeadId
      )
      OUTPUT INSERTED.Eid
      VALUES (
        @EName, @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
        @EDocNo, 'Approved', SYSDATETIME(), SYSDATETIME(), @ECompanyId, @EFinYear,
        'TOD', 'full', 'Paid', 200000, 0, @LHeadId
      )
    `);
  const originEbId = originatingEb.recordset[0].Eid;
  console.log(`Originating (overpaid) invoice: Eid ${originEbId} / SMOKE-INV-OA-ORIGIN-01 — fully paid, excess stored as credit`);

  // The excess is recorded against a real payment (OnAccountLedger.RefDocNo
  // joins to NewPayment.DocNo, not directly to the invoice) — the /adjustable
  // endpoint resolves InvoiceRef from that payment's PExpenseRef, which is
  // what excludeOriginatingInvoice() on the frontend filters the picker by.
  const originPayment = await pool.request()
    .input("PPaymentName", sql.NVarChar(200), "On AC advance — Demo Steel Suppliers")
    .input("PMode", sql.NVarChar(50), "Bank Transfer")
    .input("PAmount", sql.Decimal(18, 2), 250000)
    .input("PDocType", sql.NVarChar(100), "TOD — Expense Booking")
    .input("PDate", sql.Date, "2026-06-20")
    .input("PBankName", sql.NVarChar(200), "HDFC - Salt Lake Branch")
    .input("PProject", sql.NVarChar(200), "ROYAL GARDEN")
    .input("PCompany", sql.NVarChar(200), "RAJWADA GROUP")
    .input("DocNo", sql.NVarChar(100), "SMOKE-PAY-OA-ORIGIN-01")
    .input("PExpenseRef", sql.NVarChar(100), "SMOKE-INV-OA-ORIGIN-01")
    .input("PPartyId", sql.Int, SUPPLIER_ID)
    .query(`
      INSERT INTO dbo.NewPayment
        (PPaymentName, PMode, PAmount, PDocType, PDate, PBankName, PProject, PCompany,
         DocNo, PExpenseRef, PPartyId, Status, PCreatedAt, PCreatedBy)
      OUTPUT INSERTED.PPaymentID
      VALUES
        (@PPaymentName, @PMode, @PAmount, @PDocType, @PDate, @PBankName, @PProject, @PCompany,
         @DocNo, @PExpenseRef, @PPartyId, 'Approved', SYSDATETIME(), 'smoke-seed')
    `);
  console.log(`Originating payment: PPaymentID ${originPayment.recordset[0].PPaymentID} / SMOKE-PAY-OA-ORIGIN-01`);

  // Two OTHER outstanding invoices for the same supplier — targets for the
  // On A/C Adjustment picker (which now excludes the originating invoice above).
  const otherInvoices = [
    { docNo: "SMOKE-INV-OA-OTHER-01", amount: 65000, name: "Sand delivery — Block C" },
    { docNo: "SMOKE-INV-OA-OTHER-02", amount: 38500, name: "Cement delivery — Block D" },
  ];
  for (const inv of otherInvoices) {
    await pool.request()
      .input("EName", sql.NVarChar(200), inv.name)
      .input("EProjectName", sql.NVarChar(150), String(PROJECT_ID))
      .input("EDocumentType", sql.NVarChar(50), "TOD")
      .input("EDocDate", sql.Date, "2026-07-05")
      .input("EAmount", sql.Decimal(18, 2), inv.amount)
      .input("ENetAmount", sql.Decimal(18, 2), inv.amount)
      .input("EDocNo", sql.NVarChar(100), inv.docNo)
      .input("ECompanyId", sql.Int, COMPANY_ID)
      .input("EFinYear", sql.NVarChar(20), FIN_YEAR)
      .input("LHeadId", sql.Int, SUPPLIER_ID)
      .query(`
        INSERT INTO dbo.ExpenseBooking (
          EName, EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          EDocNo, EStatus, ECreatedAt, EUpdatedAt, ECompanyId, EFinYear,
          ESourceType, EPaymentType, EBillStatus, ETotalPaid, ERemainingAmount, LHeadId
        )
        VALUES (
          @EName, @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @EDocNo, 'Approved', SYSDATETIME(), SYSDATETIME(), @ECompanyId, @EFinYear,
          'TOD', 'full', 'Payment Due', 0, @EAmount, @LHeadId
        )
      `);
    console.log(`Other adjustable invoice: ${inv.docNo} — ₹${inv.amount} outstanding`);
  }

  // Materialized on-account balance + ledger entry (matches how the
  // approve-time hook in newPayment.js keeps these two in lockstep).
  const CREDIT_AMOUNT = 50000;
  await pool.request()
    .input("LHeadId", sql.Int, SUPPLIER_ID)
    .input("Amount", sql.Decimal(18, 2), CREDIT_AMOUNT)
    .query(`UPDATE dbo.AccountHeadMaster SET OnAccountBalance = ISNULL(OnAccountBalance, 0) + @Amount WHERE LHeadId = @LHeadId`);

  await pool.request()
    .input("PartyId", sql.Int, SUPPLIER_ID)
    .input("PartyType", sql.NVarChar(20), "Supplier")
    .input("TxnDate", sql.Date, "2026-06-20")
    .input("Amount", sql.Decimal(18, 2), CREDIT_AMOUNT)
    .input("RefDocNo", sql.NVarChar(100), "SMOKE-PAY-OA-ORIGIN-01")
    .input("CompanyId", sql.Int, COMPANY_ID)
    .input("ProjectId", sql.Int, PROJECT_ID)
    .input("Notes", sql.NVarChar(500), "[SMOKE] Excess payment stored as on-account credit for Demo Steel Suppliers Pvt Ltd")
    .query(`
      INSERT INTO dbo.OnAccountLedger
        (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, AdjRefDocNo, CompanyId, ProjectId, Notes, CreatedBy)
      VALUES
        (@PartyId, @PartyType, @TxnDate, 'CREDIT', @Amount, 'Payment', @RefDocNo, NULL, @CompanyId, @ProjectId, @Notes, 'smoke-seed')
    `);
  console.log(`On-account credit: ₹${CREDIT_AMOUNT} for LHeadId ${SUPPLIER_ID}`);

  console.log("\nDone. View at:");
  console.log("  Supplier Portal (supplier1@demo.com) -> Received by Customer");
  console.log("  Finance -> On A/C Adjustment  (/on-account-adjustment)");
  console.log("  Finance -> Payment  (create new, select SMOKE-INV-OA-OTHER-01/02)");
  await pool.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
