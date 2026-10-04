const { connectDB, getPool } = require('./backend/db');
const { renderWelcomeCallPdfBuffer } = require('./backend/services/welcomeCallPdf');
const fs = require('fs');

connectDB().then(async () => {
  const pool = getPool();
  const bkg = await pool.request().query(`
    SELECT b.BookingNo, b.UnitNo, a.ApplicantName,
           proj.name AS ProjectName,
           comp.logo AS CompanyLogo, comp.name AS CompanyName,
           comp.address AS CompanyAddress, comp.city AS CompanyCity,
           comp.state AS CompanyState, comp.pincode AS CompanyPincode,
           comp.gst_no AS CompanyGst, comp.phone AS CompanyPhone
    FROM dbo.CrmBooking b
    LEFT JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    WHERE b.Id = 70
  `);
  const buf = await renderWelcomeCallPdfBuffer({
    ...bkg.recordset[0],
    SubmittedAt: new Date(),
    SubmittedByName: 'Super Admin',
    sections: [
      {
        label: 'Identity & Booking Confirmation',
        complete: true,
        items: [
          { Label: 'Applicant identity confirmed with government-issued photo ID', IsChecked: true,  RecheckStatus: null,   Remarks: '' },
          { Label: 'Booking amount and booking date acknowledged by customer',      IsChecked: true,  RecheckStatus: null,   Remarks: 'Customer confirmed on call' },
          { Label: 'Unit details verified — tower, floor, wing, area',              IsChecked: false, RecheckStatus: null,   Remarks: '' },
        ]
      },
      {
        label: 'Payment Plan & Financials',
        complete: false,
        items: [
          { Label: 'Payment schedule explained and customer acknowledged each milestone', IsChecked: true,  RecheckStatus: 'Open', Remarks: 'To re-confirm next call' },
          { Label: 'GST implications and breakup explained',                              IsChecked: false, RecheckStatus: null,   Remarks: '' },
          { Label: 'Home loan requirement discussed',                                     IsChecked: true,  RecheckStatus: null,   Remarks: 'Self-funded' },
        ]
      },
      {
        label: 'Documents',
        complete: false,
        items: [
          { Label: 'PAN Card submitted',       IsChecked: true,  RecheckStatus: null, Remarks: '' },
          { Label: 'Aadhaar Card submitted',   IsChecked: true,  RecheckStatus: null, Remarks: '' },
          { Label: 'Passport photo submitted', IsChecked: false, RecheckStatus: null, Remarks: '' },
          { Label: 'Address proof submitted',  IsChecked: false, RecheckStatus: null, Remarks: '' },
        ]
      }
    ]
  });
  fs.writeFileSync('test_welcome_call.pdf', buf);
  console.log('PDF written:', buf.length, 'bytes');
}).catch(console.error).finally(() => process.exit(0));
