const sql = require('mssql');
const cfg = {
  server: '192.168.0.205',
  database: 'Civilier',
  user: 'sa',
  password: 'infotech@123',
  options: { encrypt: false, trustServerCertificate: true }
};

const migrations = [
  '013-fix-user-role-assignments.sql',
  '014-create-user-page-rights-json.sql',
  '015-add-avatar-to-users.sql',
  '015-expense-emi-approval-docnumber.sql',
  '015b-expense-emi-approval-docnumber.sql',
  '016-create-tenant-reminders-table.sql',
  '017-create-received-payment.sql',
  '018-enterprise-new-fields.sql',
  '019-create-menu-master.sql',
  '020-add-doctype-to-po-wo-grn-debitnote.sql',
  '021-create-contractor-category.sql',
  '022-create-approval-workflows.sql',
  '023-create-company-master.sql',
  '024-create-project-master.sql',
  '025-create-communicator-config.sql',
  '026-create-signatures.sql',
  '027-create-dba-ads.sql',
  '028-create-dba-payment-logs.sql',
  '029-cleanup-expensebooking-generic-approval-columns.sql',
  '030-followup-module.sql',
  '031-add-poitems-column.sql',
  '031-followup-sales-pipeline-core.sql',
  '032-add-discount-to-purchaseorders.sql',
  '032-add-moduletag-to-typeofdoc.sql',
  '033-add-gst-to-purchaseorders-workorder.sql',
];

sql.connect(cfg).then(async pool => {
  for (const name of migrations) {
    try {
      await pool.request().query(`INSERT INTO dbo.__Migrations (name) VALUES ('${name}')`);
      console.log(`marked: ${name}`);
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        console.log(`already marked: ${name}`);
      } else {
        console.error(`error on ${name}: ${err.message}`);
      }
    }
  }
  console.log('\nDone. Now run: node migrate.js up');
  process.exit(0);
}).catch(err => {
  console.error(err.message);
  process.exit(1);
});
