const fs = require('fs');
let c = fs.readFileSync('src/pages/CRM/CrmBookingDetail.tsx', 'utf8');
const search =                                 <button onClick={() => setPreviewInvoice(inv)}
                                  className=\"flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline\">
                                  <Eye size={12} /> View
                                </button>;
const replacement =                                 <div className=\"flex items-center gap-2\">
                                  <button onClick={() => setPreviewInvoice(inv)}
                                    className=\"flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline\">
                                    <Eye size={12} /> View
                                  </button>
                                  <button onClick={() => handleDownloadInvoicePdf(inv)}
                                    className=\"flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline\">
                                    <Download size={12} /> Download
                                  </button>
                                </div>;
c = c.replace(search, replacement);
fs.writeFileSync('src/pages/CRM/CrmBookingDetail.tsx', c);

