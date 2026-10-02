"use strict";
/**
 * Removes everything scripts/e2eCrmPlotLifecycle.js created: test data only,
 * found through the application's ApplicantName tag. Hard delete is right
 * here: these rows never represented a real sale. Document numbers
 * (BKG / MR / OACC / invoice) that the run consumed are NOT rolled back.
 *
 * Child rows are found through the database's own foreign keys, so a table
 * added later that references a booking is cleaned without editing this
 * file. Logs that point at a record by id without a foreign key are listed
 * explicitly below.
 *
 * Run on its own: node backend/scripts/e2eCrmPlotLifecycleCleanup.js [TAG]
 */
const path = require("path");

async function cleanup(pool, tag) {
  if (!tag || tag.length < 4) throw new Error("refusing to clean without a specific tag");
  const like = `${tag}%`;
  const one = async (t, inputs = {}) => {
    const r = pool.request();
    for (const [k, v] of Object.entries(inputs)) r.input(k, v);
    return (await r.query(t)).recordset;
  };
  const ids = (rows, k = "Id") => rows.map((r) => r[k]).filter((x) => x != null);
  const inList = (a) => (a.length ? a.join(",") : "NULL");

  const apps = ids(await one("SELECT Id FROM dbo.CrmApplication WHERE ApplicantName LIKE @t", { t: like }));
  const customers = ids(await one("SELECT Id FROM dbo.CrmCustomer WHERE CustomerName LIKE @t", { t: like }));
  const bookings = ids(await one(`SELECT Id FROM dbo.CrmBooking WHERE ApplicationId IN (${inList(apps)})`));
  const milestones = ids(await one(`SELECT Id FROM dbo.CrmPaymentMilestone WHERE BookingId IN (${inList(bookings)})`));
  const oas = ids(await one(`SELECT Id FROM dbo.CrmOnAccountPayment WHERE BookingId IN (${inList(bookings)})`));
  const invoices = ids(await one(`SELECT Id FROM dbo.CrmInvoice WHERE BookingId IN (${inList(bookings)})`));
  const mrs = ids(await one(`SELECT Id FROM dbo.CrmMoneyReceipt WHERE BookingId IN (${inList(bookings)})`));
  const rps = ids(await one(`SELECT RPPaymentID FROM dbo.ReceivedPayment WHERE CrmBookingId IN (${inList(bookings)}) OR CrmApplicationId IN (${inList(apps)})`), "RPPaymentID");
  const heads = ids(await one("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName LIKE @t AND LHeadType = 'RC'", { t: like }), "LHeadId");
  if (!apps.length && !customers.length && !heads.length) { console.log("[cleanup] nothing tagged — clean"); return; }
  console.log(`[cleanup] applications ${apps} | bookings ${bookings} | customers ${customers} | receipts ${rps} | deposits ${oas} | invoices ${invoices} | ledger heads ${heads}`);

  const tx = pool.transaction();
  await tx.begin();
  const q = async (t) => (await tx.request().query(t)).rowsAffected[0];
  try {
    // Ledger: every voucher with a leg on this sale's records or customer.
    const vouchers = (await tx.request().query(`
      SELECT DISTINCT VoucherNo FROM dbo.GeneralLedgerEntry
      WHERE (SourceType = 'CrmOnAccountPayment' AND SourceId IN (${inList(oas)}))
         OR (SourceType LIKE '%Invoice%' AND SourceId IN (${inList(invoices)}))
         OR (SourceType LIKE '%Receipt%' AND SourceId IN (${inList([...rps, ...mrs])}))
         OR (SourceType LIKE '%Milestone%' AND SourceId IN (${inList(milestones)}))
         OR LHeadId IN (${inList(heads)})`)).recordset.map((r) => r.VoucherNo);
    if (vouchers.length) {
      const list = vouchers.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(",");
      console.log(`[cleanup] GL vouchers ${vouchers.join(", ")}: ${await q(`DELETE FROM dbo.GeneralLedgerEntry WHERE VoucherNo IN (${list})`)} legs`);
    }
    await q(`DELETE FROM dbo.OnAccountLedger WHERE (RefType = 'CrmOnAccountPayment' AND RefId IN (${inList(oas)})) OR (PartyType = 'Customer' AND PartyId IN (${inList(heads)}))`);
    await q(`DELETE FROM dbo.GLPostingLog WHERE (Module = 'crm-bookings' AND RecordId IN (${inList(bookings)}))
      OR (Module = 'crm-on-account-payment' AND RecordId IN (${inList(oas)}))
      OR (Module IN ('crm-received-payment', 'received-payment') AND RecordId IN (${inList(rps)}))
      OR (Module LIKE '%invoice%' AND RecordId IN (${inList(invoices)}))
      OR (Module LIKE '%money-receipt%' AND RecordId IN (${inList(mrs)}))`);
    await q(`DELETE FROM dbo.ApprovalAuditLog WHERE (TableName = 'CrmApplication' AND RecordId IN (${inList(apps)}))
      OR (TableName = 'CrmBooking' AND RecordId IN (${inList(bookings)})) OR (TableName = 'ReceivedPayment' AND RecordId IN (${inList(rps)}))`);
    await q(`DELETE FROM dbo.CrmAuditLog WHERE (EntityType = 'Booking' AND EntityId IN (${inList(bookings)}))
      OR (EntityType = 'Application' AND EntityId IN (${inList(apps)})) OR (EntityType = 'ReceivedPayment' AND EntityId IN (${inList(rps)}))
      OR (EntityType = 'Customer' AND EntityId IN (${inList(customers)}))`);
    await q(`DELETE FROM dbo.SaNotification WHERE (RefType = 'crm_booking' AND RefId IN (${inList(bookings)}))
      OR (RefType = 'payment_milestone' AND RefId IN (${inList(milestones)})) OR (RefType = 'crm_application' AND RefId IN (${inList(apps)}))`);

    // Foreign-key children first, then the record itself, recursively.
    const fkCache = new Map();
    const childrenOf = async (table) => {
      if (fkCache.has(table)) return fkCache.get(table);
      const rows = (await tx.request().input("t", table).query(`
        SELECT OBJECT_NAME(fk.parent_object_id) AS child, pc.name AS col,
               (SELECT TOP 1 c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE i.object_id = fk.parent_object_id AND i.is_primary_key = 1) AS pk
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        WHERE fk.referenced_object_id = OBJECT_ID('dbo.' + @t)`)).recordset;
      fkCache.set(table, rows);
      return rows;
    };
    const purge = async (table, pk, idList, depth = 0) => {
      if (!idList.length || depth > 8) return;
      for (const ch of await childrenOf(table)) {
        if (ch.child === table) continue;
        if (ch.pk) {
          const childIds = (await tx.request().query(`SELECT [${ch.pk}] AS id FROM dbo.[${ch.child}] WHERE [${ch.col}] IN (${idList.join(",")})`)).recordset.map((r) => r.id);
          await purge(ch.child, ch.pk, childIds, depth + 1);
        } else {
          await q(`DELETE FROM dbo.[${ch.child}] WHERE [${ch.col}] IN (${idList.join(",")})`);
        }
      }
      const n = await q(`DELETE FROM dbo.[${table}] WHERE [${pk}] IN (${idList.join(",")})`);
      if (n) console.log(`[cleanup] ${table}: ${n}`);
    };

    // Rows that point at the sale by plain column (no FK) — in dependency order.
    await purge("CrmInvoice", "Id", invoices);
    await purge("CrmOnAccountPayment", "Id", oas);
    await purge("CrmMoneyReceipt", "Id", mrs);
    await purge("ReceivedPayment", "RPPaymentID", rps);
    await purge("CrmPaymentMilestone", "Id", milestones);
    for (const t of ["CrmBookingPlot", "CrmBookingStageLog", "CrmBookingDocument", "CrmCustomerBankDetail"]) {
      const n = await q(`DELETE FROM dbo.[${t}] WHERE BookingId IN (${inList(bookings)})`);
      if (n) console.log(`[cleanup] ${t}: ${n}`);
    }
    await purge("CrmBooking", "Id", bookings);
    for (const t of ["CrmApplicationPlot", "CrmApplicationVerificationChecklist", "CrmApplicationStatusLog", "CrmInventoryHold",
                     "CrmCustomerPortalUser", "CrmBookingDocument", "CrmCustomerBankDetail"]) {
      const n = await q(`DELETE FROM dbo.[${t}] WHERE ApplicationId IN (${inList(apps)})`);
      if (n) console.log(`[cleanup] ${t}: ${n}`);
    }
    await q(`UPDATE dbo.SaLead SET CrmApplicationId = NULL, CrmBookingId = NULL WHERE CrmApplicationId IN (${inList(apps)})`);
    await purge("CrmApplication", "Id", apps);
    await q(`DELETE FROM dbo.CrmCustomerPortalUser WHERE CustomerId IN (${inList(customers)})`);
    await purge("CrmCustomer", "Id", customers);
    await purge("AccountHeadMaster", "LHeadId", heads);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  const left = (await one(`SELECT
      (SELECT COUNT(*) FROM dbo.CrmApplication WHERE ApplicantName LIKE @t) a,
      (SELECT COUNT(*) FROM dbo.CrmCustomer WHERE CustomerName LIKE @t) c,
      (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LHeadName LIKE @t) h`, { t: like }))[0];
  if (left.a || left.c || left.h) throw new Error(`cleanup left rows behind: ${JSON.stringify(left)}`);
  console.log("[cleanup] done — no tagged rows remain");
}

module.exports = { cleanup };

if (require.main === module) {
  const BACKEND = path.join(__dirname, "..");
  require(path.join(BACKEND, "config/env")).loadEnv();
  const { connectDB, getPool } = require(path.join(BACKEND, "db"));
  (async () => {
    await connectDB();
    try { await cleanup(getPool(), process.argv[2] || "ZZE2E"); process.exit(0); }
    catch (e) { console.error(e.stack || e.message); process.exit(1); }
  })();
}
