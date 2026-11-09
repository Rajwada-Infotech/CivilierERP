"use strict";

/**
 * The Approval Inbox's common row structure. Every document type in the inbox is its own query (routes/approvalInbox.js)
 * and shows what is special to it (a godown route, a voucher summary, an activity name ...). On top of that every row
 * should answer the same four questions, whatever the document is:
 *
 *   who is it for   SupplierName   the party / person (payee, supplier, contractor, customer, applicant)
 *   which company   CompanyName
 *   which project   ProjectName
 *   how much        Amount
 *
 * enrichInboxRows runs after the per-document queries have been merged and filtered. For each document type it reads the
 * company, project and party straight from the document's own table and FILLS ONLY WHAT IS STILL EMPTY, so whatever a
 * document type already resolves for itself (its own party wording, a godown route ...) is never overwritten. A document
 * type with no entry here, or one whose lookup fails, simply keeps its row as it was.
 */

const logger = require("../logger");

// SQL helpers: a name from an id held in a column of the document's table (alias t / x).
const ent = (col) => `(SELECT TOP 1 e.name FROM dbo.enterprise e WHERE e.id = TRY_CAST(${col} AS INT))`;
const head = (col) => `(SELECT TOP 1 ISNULL(h.DisplayName, h.LHeadName) FROM dbo.AccountHeadMaster h WHERE h.LHeadId = TRY_CAST(${col} AS INT))`;
const crmCust = (col) => `(SELECT TOP 1 c.CustomerName FROM dbo.CrmCustomer c WHERE c.Id = ${col})`;

// A CRM document hangs off a booking (and its application); company and project come from the booking.
const crmBooking = (table, fk = "BookingId") => ({
  from: `dbo.${table} x JOIN dbo.CrmBooking t ON t.Id = x.${fk} JOIN dbo.CrmApplication a ON a.Id = t.ApplicationId`,
  key: "x.Id",
  company: ent("t.CompanyId"),
  project: `COALESCE(${ent("t.ProjectId")}, NULLIF(t.ProjectName, N''))`,
  party: "a.ApplicantName",
});

// module tag (the inbox row's Module) -> where its company / project / party live.
//   from    FROM + JOINs, the document's own table aliased t (or x with t as the booking)
//   key     the column the inbox row's RecordId holds
//   company / project / party   SQL expressions that return a name (null when the document has none)
const SPECS = {
  // An amendment shows the amended document's company / project, and (for a PO) its supplier.
  "doc-amendment": {
    from: "dbo.DocAmendment t LEFT JOIN dbo.PurchaseOrders po_da ON t.DocType = N'purchase-order' AND po_da.PurchaseOrderID = t.DocId",
    key: "t.Id",
    company: ent("t.CompanyId"),
    project: ent("t.ProjectId"),
    party: head("po_da.SupplierID"),
  },
  "purchase-orders": { from: "dbo.PurchaseOrders t", key: "t.PurchaseOrderID", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: head("t.SupplierID") },
  "work-orders": { from: "dbo.WorkOrderHeader t", key: "t.Id", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: `COALESCE(${head("t.ContractorId")}, ${head("t.SupplierId")})` },
  "work-done": { from: "dbo.WorkDone t", key: "t.ID", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: head("t.SupplierId") },
  "goods-receipt": {
    from: "dbo.GoodsReceiptNotes t JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = t.POID", key: "t.GRNID",
    company: ent("po.CompanyId"), project: ent("po.ProjectId"), party: head("t.SupplierID"),
  },
  "expense-booking": { from: "dbo.ExpenseBooking t", key: "t.Eid", company: ent("t.ECompanyId"), project: ent("t.EProjectName"), party: head("t.LHeadId") },
  "boq": { from: "dbo.BOQ t", key: "t.BoqID", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: "NULL" },
  "material-requests": { from: "dbo.MaterialRequests t", key: "t.MRId", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: "NULL" },
  "vehicle-in-out": { from: "dbo.VehicleInOut t", key: "t.VehicleInOutID", company: ent("t.CompanyID"), project: ent("t.ProjectID"), party: head("t.SupplierID") },
  "material-issues": { from: "dbo.MaterialIssues t", key: "t.IssueId", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: "NULL" },
  "material-issue-return": { from: "dbo.MaterialIssueReturn t", key: "t.ReturnId", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: "NULL" },
  "sale-orders": { from: "dbo.SaleOrders t", key: "t.SaleOrderID", company: ent("t.FromCompanyID"), project: ent("t.FromProjectID"), party: "NULL" },
  "journal-voucher": { from: "dbo.JournalVoucher t", key: "t.JVID", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: "NULL" },
  "inter-company-transfer": { from: "dbo.InterCompanyTransfer t", key: "t.ICTId", company: ent("t.SenderCompanyId"), project: ent("t.SenderProjectId"), party: "NULL" },
  "fund-transfer": { from: "dbo.FundTransfer t", key: "t.FTId", company: ent("t.SourceCompanyId"), project: "NULL", party: "NULL" },
  "debit-note": { from: "dbo.DebitNote t", key: "t.id", company: ent("t.company_id"), project: ent("t.project_id"), party: head("t.supplier_id") },
  "contracts": { from: "dbo.Contract t", key: "t.ContractId", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: head("t.ContactPartyId") },
  "received-payment": { from: "dbo.ReceivedPayment t", key: "t.RPPaymentID", company: `COALESCE(${ent("t.RPCompanyId")}, NULLIF(t.RPCompanyName, N''))`, project: `COALESCE(${ent("t.RPProjectId")}, NULLIF(t.RPProjectName, N''))`, party: "NULLIF(t.RPCustomerName, N'')" },
  // Payments: the payee is filled by the inbox query itself; the company is the payment's own.
  "payments": { from: "dbo.NewPayment t", key: "t.PPaymentID", company: ent("t.PCompany"), project: "NULL", party: "NULL" },
  "crm-refund-payment": { from: "dbo.NewPayment t", key: "t.PPaymentID", company: ent("t.PCompany"), project: "NULL", party: "NULL" },
  "crm-bookings": {
    from: "dbo.CrmBooking t JOIN dbo.CrmApplication a ON a.Id = t.ApplicationId", key: "t.Id",
    company: ent("t.CompanyId"), project: `COALESCE(${ent("t.ProjectId")}, NULLIF(t.ProjectName, N''))`, party: "a.ApplicantName",
  },
  "crm-agreements": crmBooking("CrmAgreement"),
  "crm-agreement-date": crmBooking("CrmAgreement"),
  "crm-sales-deed-director": crmBooking("CrmSalesDeed"),
  "crm-brokerage": crmBooking("CrmBrokerageMaster"),
  "crm-cancellations": crmBooking("CrmCancellation"),
  "crm-noc": crmBooking("CrmNoc"),
  "crm-booking-amendment": crmBooking("CrmBookingAmendmentRequest"),
  "crm-refunds": { from: "dbo.CrmRefund t", key: "t.Id", company: ent("t.CompanyId"), project: ent("t.ProjectId"), party: crmCust("t.CustomerId") },
  "crm-resales": {
    from: "dbo.CrmUnitResale t LEFT JOIN dbo.CrmBooking b ON b.Id = t.FromBookingId", key: "t.Id",
    company: ent("b.CompanyId"), project: `COALESCE(${ent("b.ProjectId")}, NULLIF(b.ProjectName, N''))`, party: crmCust("t.FromCustomerId"),
  },
  "crm-ownership-changes": {
    from: "dbo.CrmOwnershipChange t LEFT JOIN dbo.CrmBooking b ON b.Id = t.BookingId", key: "t.Id",
    company: ent("b.CompanyId"), project: `COALESCE(${ent("b.ProjectId")}, NULLIF(b.ProjectName, N''))`, party: crmCust("t.FromCustomerId"),
  },
  // An activity approval: the project is the activity's; the company is that project's own company.
  "civilworkdpr-approval": {
    from: "dbo.DependencyMasterActivity t JOIN dbo.DependencyMaster dm ON dm.Id = t.DependencyMasterId", key: "t.Id",
    company: "(SELECT TOP 1 ce.name FROM dbo.enterprise pe JOIN dbo.enterprise ce ON ce.id = pe.company_id WHERE pe.id = dm.ProjectId)",
    project: ent("dm.ProjectId"), party: "NULL",
  },
};

const blank = (v) => v == null || String(v).trim() === "";
const isCount = (n) => Number.isInteger(n) && n > 0;

/** The SQL for one document type and a set of record ids (exported for tests and for the validity check). */
function enrichmentSql(module, ids) {
  const spec = SPECS[module];
  if (!spec) return null;
  const list = ids.filter(isCount);
  if (!list.length) return null;
  return `SELECT CAST(${spec.key} AS NVARCHAR(40)) AS RecordId, ${spec.company} AS CompanyName, ${spec.project} AS ProjectName, ${spec.party} AS PartyName
          FROM ${spec.from} WHERE ${spec.key} IN (${list.join(",")})`;
}

/** Fills CompanyName, ProjectName and SupplierName on the rows that lack them. Mutates and returns rows; never throws. */
async function enrichInboxRows(pool, rows) {
  if (!rows?.length) return rows;
  const byModule = new Map();
  for (const r of rows) {
    if (!SPECS[r.Module]) continue;
    const list = byModule.get(r.Module) ?? [];
    list.push(r);
    byModule.set(r.Module, list);
  }
  for (const [module, list] of byModule) {
    try {
      const sql = enrichmentSql(module, [...new Set(list.map((r) => parseInt(r.RecordId, 10)))]);
      if (!sql) continue;
      const found = new Map((await pool.request().query(sql)).recordset.map((x) => [String(x.RecordId), x]));
      for (const r of list) {
        const hit = found.get(String(r.RecordId));
        if (!hit) continue;
        if (blank(r.CompanyName) && !blank(hit.CompanyName)) r.CompanyName = hit.CompanyName;
        if (blank(r.ProjectName) && !blank(hit.ProjectName)) r.ProjectName = hit.ProjectName;
        if (blank(r.SupplierName) && !blank(hit.PartyName)) r.SupplierName = hit.PartyName;
      }
    } catch (err) {
      // One document type's lookup failing must not take the inbox down: its rows just keep what they had.
      logger.warn({ err: err.message, module }, "approval-inbox enrichment skipped for module");
    }
  }
  return rows;
}

module.exports = { enrichInboxRows, enrichmentSql, SPECS };
