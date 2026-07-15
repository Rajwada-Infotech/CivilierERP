"use strict";
/**
 * Seed demo RFQ/Quotation smoke data for supplier1@demo.com (Demo Steel
 * Suppliers Pvt Ltd, LHeadId 74) — connects the "Total RFQs / Pending /
 * Submitted" stat chips on the supplier portal home page to real data
 * (they were showing 0/0/0 because no quotations had been tagged to this
 * supplier yet).
 *
 * Run: node backend/scripts/seedSupplierDemoQuotations.js
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
const DOC_TYPE_ID = 24; // matches existing QT doc type used in-app

async function insertQuotation(pool, { docNo, docDate, dueDate, status, items }) {
  const q = await pool.request()
    .input("DocNo", sql.NVarChar(100), docNo)
    .input("DocDate", sql.Date, docDate)
    .input("DueDate", sql.Date, dueDate)
    .input("CompanyId", sql.Int, COMPANY_ID)
    .input("ProjectId", sql.Int, PROJECT_ID)
    .input("Status", sql.NVarChar(30), status)
    .query(`
      INSERT INTO dbo.Quotations
        (DocNo, DocTypeId, CompanyId, ProjectId, DocDate, DueDate, Status, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt)
      OUTPUT INSERTED.QuotationId
      VALUES
        (@DocNo, ${DOC_TYPE_ID}, @CompanyId, @ProjectId, @DocDate, @DueDate, @Status, 'smoke-seed', 'smoke-seed', SYSDATETIME(), SYSDATETIME())
    `);
  const quotationId = q.recordset[0].QuotationId;

  const itemIds = [];
  for (const it of items) {
    const r = await pool.request()
      .input("QuotationId", sql.Int, quotationId)
      .input("ItemId", sql.NVarChar(100), it.itemId)
      .input("ItemName", sql.NVarChar(200), it.itemName)
      .input("UOMCode", sql.NVarChar(20), it.uom)
      .input("Quantity", sql.Decimal(18, 2), it.quantity)
      .query(`
        INSERT INTO dbo.QuotationItems
          (QuotationId, ItemId, ItemName, UOMCode, Quantity)
        OUTPUT INSERTED.QuotationItemId
        VALUES
          (@QuotationId, @ItemId, @ItemName, @UOMCode, @Quantity)
      `);
    itemIds.push(r.recordset[0].QuotationItemId);
  }

  await pool.request()
    .input("QuotationId", sql.Int, quotationId)
    .input("SupplierLHeadId", sql.Int, SUPPLIER_ID)
    .input("Status", sql.NVarChar(20), status === "Quoted" ? "Submitted" : "Pending")
    .query(`
      INSERT INTO dbo.QuotationSuppliers (QuotationId, SupplierLHeadId, Status, InvitedAt)
      VALUES (@QuotationId, @SupplierLHeadId, @Status, SYSDATETIME())
    `);

  return { quotationId, itemIds };
}

async function run() {
  const pool = await sql.connect(config);
  console.log("Connected to DB");

  // ── 1. Pending RFQ — due soon, not yet submitted ──────────────────────────
  const dueSoon = new Date();
  dueSoon.setDate(dueSoon.getDate() + 2);
  const q1 = await insertQuotation(pool, {
    docNo: "SMOKE-QT-PENDING-01",
    docDate: "2026-07-12",
    dueDate: dueSoon.toISOString().slice(0, 10),
    status: "Sent",
    items: [
      { itemId: "SMOKE-ITEM-SAND-01", itemName: "Sand", uom: "Bags", quantity: 60 },
      { itemId: "SMOKE-ITEM-CEMENT-01", itemName: "Cement", uom: "Bags", quantity: 30 },
    ],
  });
  console.log(`Pending RFQ: QuotationId ${q1.quotationId} / SMOKE-QT-PENDING-01 (due ${dueSoon.toISOString().slice(0, 10)})`);

  // ── 2. Submitted RFQ — supplier already priced every item ─────────────────
  const q2 = await insertQuotation(pool, {
    docNo: "SMOKE-QT-SUBMITTED-01",
    docDate: "2026-07-01",
    dueDate: "2026-07-08",
    status: "Quoted",
    items: [
      { itemId: "SMOKE-ITEM-STEEL-01", itemName: "TMT Steel Bar 12mm", uom: "Kg", quantity: 500 },
    ],
  });
  const rates = [{ quotationItemId: q2.itemIds[0], rate: 68.5 }];
  for (const r of rates) {
    await pool.request()
      .input("QuotationId", sql.Int, q2.quotationId)
      .input("SupplierLHeadId", sql.Int, SUPPLIER_ID)
      .input("QuotationItemId", sql.Int, r.quotationItemId)
      .input("Rate", sql.Decimal(18, 2), r.rate)
      .input("SupplyDate", sql.Date, "2026-07-15")
      .input("Quality", sql.NVarChar(200), "Fe500D, ISI marked")
      .query(`
        INSERT INTO dbo.QuotationSupplierPrices
          (QuotationId, SupplierLHeadId, QuotationItemId, Rate, SupplyDate, Quality, SubmittedAt)
        VALUES
          (@QuotationId, @SupplierLHeadId, @QuotationItemId, @Rate, @SupplyDate, @Quality, SYSDATETIME())
      `);
  }
  console.log(`Submitted RFQ: QuotationId ${q2.quotationId} / SMOKE-QT-SUBMITTED-01 (priced)`);

  console.log("\nDone. View at: Supplier Portal (supplier1@demo.com) home page — Total RFQs/Pending/Submitted stat chips + Active Quotations list.");
  await pool.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
