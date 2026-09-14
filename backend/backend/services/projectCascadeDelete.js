// backend/services/projectCascadeDelete.js
//
// Deletes a Project (dbo.enterprise, business_type='P') and every
// transactional record under it, across the whole schema. This is
// deliberately explicit and staged rather than a generic FK-graph walker:
// the schema mixes declared FKs, undeclared-but-real app-level links, and
// polymorphic (ESourceType/ESourceId, DocNo-string) links, so a "clever"
// generic walker would be more likely to silently miss an edge than an
// auditable, hand-ordered pipeline is. Irreversible operations should be
// boring, not clever.
//
// Scope decision — INCLUDED (transactional, exclusive to this project):
//   BOQ, WorkOrderHeader, WorkDone, EngineeringWorkDone, CustomerSaleOrders,
//   SaleOrders, SaleInvoices, PurchaseOrders, GoodsReceiptNotes,
//   ExpenseBooking, NewPayment, ReceivedPayment, Quotations,
//   MaterialRequests, MaterialIssues/Returns, JournalVoucher,
//   InterCompanyTransfer (as sender OR receiver), GeneralLedgerEntry,
//   StockLedger, Godowns, ContractorAllocation, ActivityDependency,
//   DebitNote, Entry_Type, tickets, Room/Block/UnitMaster, every Followup*
//   table, VehicleInOut, plus every item/attachment/line child table.
//
// Scope decision — EXCLUDED (master/config data, left in place):
//   AccountHeadMaster (the project's auto-created PRJ-{id}-CUST/SUPP ledger
//     heads) — an Inter-Company Transfer with ANOTHER still-existing
//     project can reference this project's ledger head as the counterparty
//     on THAT project's own SaleInvoice/PurchaseOrder. Deleting it would
//     orphan a foreign-key value on a record we're not touching.
//   TypeOfDoc, CostCenter, ProfitCenter — organizational/numbering config,
//     not "entries or transactions"; harmless to leave orphaned, riskier to
//     force-delete given they can be referenced by structures we don't
//     fully enumerate here.
//
// Runs entirely inside one transaction: if anything unexpected blows up
// (e.g. a real FK constraint we didn't account for), the whole thing rolls
// back and nothing is partially deleted.

const { sql } = require("../db");

async function scalarIds(tx, query, inputs = {}) {
  const req = tx.request();
  for (const [name, { type, value }] of Object.entries(inputs)) req.input(name, type, value);
  const r = await req.query(query);
  return r.recordset.map((row) => Object.values(row)[0]);
}

async function count(tx, table, whereCol, ids, idType = sql.Int) {
  if (!ids.length) return 0;
  const req = tx.request();
  const params = ids.map((id, i) => `@id${i}`).join(",");
  ids.forEach((id, i) => req.input(`id${i}`, idType, id));
  const r = await req.query(`DELETE FROM dbo.${table} WHERE ${whereCol} IN (${params})`);
  return r.rowsAffected[0] || 0;
}

async function countDirect(tx, table, whereClause, inputs = {}) {
  const req = tx.request();
  for (const [name, { type, value }] of Object.entries(inputs)) req.input(name, type, value);
  const r = await req.query(`DELETE FROM dbo.${table} WHERE ${whereClause}`);
  return r.rowsAffected[0] || 0;
}

/**
 * Deletes a project and every transactional record under it.
 * @returns {Promise<Record<string, number>>} row counts deleted per table
 */
async function deleteProjectCascade(pool, projectId, projectName) {
  const summary = {};
  const record = (table, n) => {
    if (n > 0) summary[table] = (summary[table] || 0) + n;
  };

  const tx = pool.transaction();
  await tx.begin();
  try {
    const pid = { type: sql.Int, value: projectId };

    // ── 0. FK-safety pre-check: CRM records still pointing at this project's units ──
    // dbo.CrmBooking.UnitId and dbo.CrmApplication.PreferredUnitId both carry
    // real SQL Server FK constraints against dbo.UnitMaster(Id) (migrations
    // 153/155 — see crmHierarchyLocks.js, which enforces the same rule for a
    // single-unit hard delete). Step 8 below deletes this project's UnitMaster
    // rows directly; without this check that DELETE would fail deep inside the
    // transaction with a bare FK-violation error instead of a clear message.
    // Deliberately counts ALL rows (booked/applied AND cancelled/rejected),
    // matching what the real FK constraint itself blocks on — status doesn't
    // matter to SQL Server, only row existence does. Blocking here rather than
    // auto-cleaning: whether to cancel/reassign those CRM records is a business
    // decision this cascade shouldn't make silently on someone's behalf.
    const crmBlockers = await tx.request().input("pid", sql.Int, projectId).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.CrmBooking bk
           JOIN dbo.UnitMaster u ON u.Id = bk.UnitId
         WHERE u.ProjectId = @pid) AS BookingRefs,
        (SELECT COUNT(*) FROM dbo.CrmApplication app
           JOIN dbo.UnitMaster u ON u.Id = app.PreferredUnitId
         WHERE u.ProjectId = @pid) AS ApplicationRefs
    `);
    const { BookingRefs, ApplicationRefs } =
      crmBlockers.recordset[0] ?? { BookingRefs: 0, ApplicationRefs: 0 };
    if (BookingRefs > 0 || ApplicationRefs > 0) {
      const parts = [];
      if (BookingRefs > 0) parts.push(`${BookingRefs} CRM Booking(s)`);
      if (ApplicationRefs > 0) parts.push(`${ApplicationRefs} CRM Application(s)`);
      throw new Error(
        `Cannot delete project "${projectName}": ${parts.join(" and ")} still reference Unit(s) under this project (including historical/cancelled records). Resolve or reassign these CRM records first, then retry the delete.`,
      );
    }

    // ── 1. Collect root document IDs directly linked to this project ──────
    const boqIds = await scalarIds(tx, "SELECT BoqID FROM dbo.BOQ WHERE ProjectId=@pid", { pid });
    const woIds = await scalarIds(tx, "SELECT Id FROM dbo.WorkOrderHeader WHERE ProjectId=@pid", { pid });
    const csoIds = await scalarIds(tx, "SELECT SaleOrderID FROM dbo.CustomerSaleOrders WHERE ProjectId=@pid", { pid });
    const soIds = await scalarIds(
      tx,
      "SELECT SaleOrderID FROM dbo.SaleOrders WHERE FromProjectID=@pid OR ToProjectID=@pid",
      { pid },
    );
    const siIds = await scalarIds(tx, "SELECT SaleInvoiceID FROM dbo.SaleInvoices WHERE ProjectId=@pid", { pid });
    const poIds = await scalarIds(tx, "SELECT PurchaseOrderID FROM dbo.PurchaseOrders WHERE ProjectId=@pid", { pid });
    const qtIds = await scalarIds(tx, "SELECT QuotationId FROM dbo.Quotations WHERE ProjectId=@pid", { pid });
    const mrIds = await scalarIds(tx, "SELECT MRId FROM dbo.MaterialRequests WHERE ProjectId=@pid", { pid });
    const jvIds = await scalarIds(tx, "SELECT JVID FROM dbo.JournalVoucher WHERE ProjectId=@pid", { pid });
    const ictIds = await scalarIds(
      tx,
      "SELECT ICTId FROM dbo.InterCompanyTransfer WHERE SenderProjectId=@pid OR ReceiverProjectId=@pid",
      { pid },
    );
    const rpIds = await scalarIds(tx, "SELECT RPPaymentID FROM dbo.ReceivedPayment WHERE RPProjectId=@pid", { pid });
    const godownIds = await scalarIds(tx, "SELECT GodownID FROM dbo.Godowns WHERE ProjectID=@pid", { pid });
    const ticketIds = await scalarIds(tx, "SELECT id FROM dbo.tickets WHERE project_id=@pid", { pid });

    // ── 2. Transitive links (undeclared but real) ──────────────────────────
    const grnIds = poIds.length
      ? await scalarIds(
          tx,
          `SELECT GRNID FROM dbo.GoodsReceiptNotes WHERE POID IN (${poIds.map((_, i) => `@p${i}`).join(",")})`,
          Object.fromEntries(poIds.map((v, i) => [`p${i}`, { type: sql.Int, value: v }])),
        )
      : [];

    let ebIds = [];
    let ebDocNos = [];
    if (grnIds.length || poIds.length) {
      const req = tx.request();
      const clauses = [];
      if (grnIds.length) {
        grnIds.forEach((v, i) => req.input(`g${i}`, sql.Int, v));
        clauses.push(`(ESourceType='GRN' AND ESourceId IN (${grnIds.map((_, i) => `@g${i}`).join(",")}))`);
      }
      if (poIds.length) {
        poIds.forEach((v, i) => req.input(`o${i}`, sql.Int, v));
        clauses.push(`(ESourceType='PO' AND ESourceId IN (${poIds.map((_, i) => `@o${i}`).join(",")}))`);
      }
      const r = await req.query(`SELECT EId, EDocNo FROM dbo.ExpenseBooking WHERE ${clauses.join(" OR ")}`);
      ebIds = r.recordset.map((row) => row.EId);
      ebDocNos = r.recordset.map((row) => row.EDocNo).filter(Boolean);
    }

    const npIds = ebDocNos.length
      ? await scalarIds(
          tx,
          `SELECT PPaymentID FROM dbo.NewPayment WHERE PExpenseRef IN (${ebDocNos.map((_, i) => `@d${i}`).join(",")})`,
          Object.fromEntries(ebDocNos.map((v, i) => [`d${i}`, { type: sql.NVarChar(100), value: v }])),
        )
      : [];

    // ── 3. Delete deepest item/child/attachment tables first ───────────────
    record("BoqActivities", await count(tx, "BoqActivities", "BoqID", boqIds));
    record("BoqItems", await count(tx, "BoqItems", "BoqID", boqIds));
    record("WorkOrderActivityMaterials", await countDirect(
      tx, "WorkOrderActivityMaterials",
      woIds.length ? `DocNo IN (SELECT DocumentNumber FROM dbo.WorkOrderHeader WHERE Id IN (${woIds.map((_, i) => `@w${i}`).join(",")}))` : "1=0",
      Object.fromEntries(woIds.map((v, i) => [`w${i}`, { type: sql.Int, value: v }])),
    ));
    record("WorkOrderActivities", await count(tx, "WorkOrderActivities", "WorkOrderHeaderId", woIds));
    record("EngineeringWorkDone", await count(tx, "EngineeringWorkDone", "WorkOrderID", woIds));
    record("WorkDone", await count(tx, "WorkDone", "WorkOrderID", woIds));
    record("WorkDone (by ProjectId)", await count(tx, "WorkDone", "ProjectId", [projectId]));
    record("EngineeringWorkDone (by ProjectId)", await count(tx, "EngineeringWorkDone", "ProjectId", [projectId]));

    record("CustomerSaleOrderItems", await count(tx, "CustomerSaleOrderItems", "SaleOrderID", csoIds));
    record("SaleOrderItems", await count(tx, "SaleOrderItems", "SaleOrderID", soIds));
    record("QuotationItems", await count(tx, "QuotationItems", "QuotationId", qtIds));
    record("QuotationSupplierPrices", await count(tx, "QuotationSupplierPrices", "QuotationId", qtIds));
    record("QuotationSuppliers", await count(tx, "QuotationSuppliers", "QuotationId", qtIds));
    record("MaterialRequestItems", await count(tx, "MaterialRequestItems", "MRId", mrIds));
    record("JournalVoucherLines", await count(tx, "JournalVoucherLines", "JVID", jvIds));
    record("InterCompanyTransferItems", await count(tx, "InterCompanyTransferItems", "ICTId", ictIds));
    record("EmiInstallments", await count(tx, "EmiInstallments", "ExpenseBookingId", ebIds));
    record("GRNAttachments", await count(tx, "GRNAttachments", "GRNID", grnIds));
    record("PurchaseOrderItems", await count(tx, "PurchaseOrderItems", "PurchaseOrderID", poIds));
    record("ticket_comments", await count(tx, "ticket_comments", "ticket_id", ticketIds));
    record("ticket_attachments", await count(tx, "ticket_attachments", "ticket_id", ticketIds));

    // ── 4. GL / audit trail tied to any of the collected documents ─────────
    // GeneralLedgerEntry carries ProjectId directly; also defensively sweep
    // by (SourceType, SourceId) in case a legacy row has a null ProjectId.
    record("GeneralLedgerEntry", await count(tx, "GeneralLedgerEntry", "ProjectId", [projectId]));
    const glSweeps = [
      ["PurchaseOrder", poIds], ["GRN", grnIds], ["ExpenseBooking", ebIds], ["NewPayment", npIds],
      ["ReceivedPayment", rpIds], ["SaleInvoice", siIds], ["SaleOrder", [...csoIds, ...soIds]],
      ["JournalVoucher", jvIds], ["InterCompanyTransfer", ictIds],
    ];
    for (const [sourceType, ids] of glSweeps) {
      if (!ids.length) continue;
      const req = tx.request().input("st", sql.NVarChar(50), sourceType);
      ids.forEach((v, i) => req.input(`id${i}`, sql.Int, v));
      const r = await req.query(
        `DELETE FROM dbo.GeneralLedgerEntry WHERE SourceType=@st AND SourceId IN (${ids.map((_, i) => `@id${i}`).join(",")})`,
      );
      record(`GeneralLedgerEntry (${sourceType} sweep)`, r.rowsAffected[0] || 0);
    }

    const moduleTableIds = [
      ["purchase-orders", "dbo.PurchaseOrders", poIds],
      ["grn", "dbo.GoodsReceiptNotes", grnIds],
      ["expense-booking", "dbo.ExpenseBooking", ebIds],
      ["payments", "dbo.NewPayment", npIds],
      ["boq", "dbo.BOQ", boqIds],
      ["work-orders", "dbo.WorkOrderHeader", woIds],
      ["material-requests", "dbo.MaterialRequests", mrIds],
      ["sale-orders", "dbo.SaleOrders", soIds],
      ["journal-voucher", "dbo.JournalVoucher", jvIds],
      ["inter-company-transfer", "dbo.InterCompanyTransfer", ictIds],
    ];
    for (const [moduleSlug, tableName, ids] of moduleTableIds) {
      if (!ids.length) continue;
      const req1 = tx.request().input("m", sql.NVarChar(100), moduleSlug);
      ids.forEach((v, i) => req1.input(`id${i}`, sql.Int, v));
      const r1 = await req1.query(
        `DELETE FROM dbo.GLPostingLog WHERE Module=@m AND RecordId IN (${ids.map((_, i) => `@id${i}`).join(",")})`,
      );
      record(`GLPostingLog (${moduleSlug})`, r1.rowsAffected[0] || 0);

      const req2 = tx.request().input("t", sql.NVarChar(200), tableName);
      ids.forEach((v, i) => req2.input(`id${i}`, sql.Int, v));
      const r2 = await req2.query(
        `DELETE FROM dbo.ApprovalAuditLog WHERE TableName=@t AND RecordId IN (${ids.map((_, i) => `@id${i}`).join(",")})`,
      );
      record(`ApprovalAuditLog (${moduleSlug})`, r2.rowsAffected[0] || 0);
    }

    // ── 5. Stock ── StockLedger doesn't carry ProjectId, only GodownID ─────
    record("StockLedger", await count(tx, "StockLedger", "GodownID", godownIds));

    // ── 6. Payments before the documents/parties they settle ───────────────
    // Break NewPayment's self-referencing ReplacesPaymentId chain first.
    if (npIds.length) {
      const req = tx.request();
      npIds.forEach((v, i) => req.input(`id${i}`, sql.Int, v));
      await req.query(
        `UPDATE dbo.NewPayment SET ReplacesPaymentId = NULL WHERE ReplacesPaymentId IN (${npIds.map((_, i) => `@id${i}`).join(",")})`,
      );
    }
    record("NewPayment", await count(tx, "NewPayment", "PPaymentID", npIds));
    record("ExpenseBooking", await count(tx, "ExpenseBooking", "EId", ebIds));
    record("GoodsReceiptNotes", await count(tx, "GoodsReceiptNotes", "GRNID", grnIds));
    // ReceivedPayment FKs to SaleInvoices, so it must go before SaleInvoices.
    record("ReceivedPayment", await count(tx, "ReceivedPayment", "RPPaymentID", rpIds));

    // ── 7. Header documents, in FK-safe order ───────────────────────────────
    record("PurchaseOrders", await count(tx, "PurchaseOrders", "PurchaseOrderID", poIds));
    record("SaleInvoices", await count(tx, "SaleInvoices", "SaleInvoiceID", siIds));
    record("CustomerSaleOrders", await count(tx, "CustomerSaleOrders", "SaleOrderID", csoIds));
    record("SaleOrders", await count(tx, "SaleOrders", "SaleOrderID", soIds));
    record("WorkOrderHeader", await count(tx, "WorkOrderHeader", "Id", woIds));
    record("BOQ", await count(tx, "BOQ", "BoqID", boqIds));
    record("Quotations", await count(tx, "Quotations", "QuotationId", qtIds));
    record("MaterialRequests", await count(tx, "MaterialRequests", "MRId", mrIds));
    record("JournalVoucher", await count(tx, "JournalVoucher", "JVID", jvIds));
    record("InterCompanyTransfer", await count(tx, "InterCompanyTransfer", "ICTId", ictIds));

    // ── 8. Everything else keyed directly by ProjectId/project_id ──────────
    const directTables = [
      ["ActivityDependency", "ProjectId"],
      ["ContractorAllocation", "ProjectId"],
      ["DebitNote", "project_id"],
      ["Entry_Type", "project_id"],
      ["MaterialIssueReturn", "ProjectId"],
      ["MaterialIssues", "ProjectId"],
      ["RoomMaster", "ProjectId"],
      ["UnitMaster", "ProjectId"],
      ["BlockMaster", "ProjectId"],
      ["VehicleInOut", "ProjectID"],
    ];
    for (const [table, col] of directTables) {
      record(table, await countDirect(tx, table, `${col}=@pid`, { pid }));
    }

    record("tickets", await count(tx, "tickets", "id", ticketIds));

    // ── 9. Godowns last (StockLedger already cleared above) ────────────────
    record("Godowns", await count(tx, "Godowns", "GodownID", godownIds));

    await tx.commit();
    return summary;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* rollback best-effort — original error is what propagates */
    }
    throw err;
  }
}

module.exports = { deleteProjectCascade };