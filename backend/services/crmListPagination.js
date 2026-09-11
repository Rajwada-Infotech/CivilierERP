// Shared page-math for CRM list endpoints being rolled out with server-side
// pagination (crmInvoices.js, crmPayments.js's /on-account, and every CRM
// list route being migrated to the same convention). Only the page/pageSize
// parsing is shared — WHERE-clause construction stays per-route since each
// table's filterable columns differ.
function applyPagination(req, defaultPageSize = 20, maxPageSize = 200) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(req.query.pageSize, 10) || defaultPageSize));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

module.exports = { applyPagination };
