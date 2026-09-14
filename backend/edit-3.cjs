const fs = require('fs');
let c = fs.readFileSync('src/pages/CRM/CrmBookingDetail.tsx', 'utf8');

c = c.replace(
  /<button onClick=\{\(\) => setPreviewInvoice\(inv\)\}\s+className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">\s+<Eye size=\{12\} \/> View\s+<\/button>/g,
  <div className="flex items-center gap-2">
    <button onClick={() => setPreviewInvoice(inv)}
      className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">
      <Eye size={12} /> View
    </button>
    <button onClick={() => handleDownloadInvoicePdf(inv)}
      className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">
      <Download size={12} /> Download
    </button>
  </div>
);

fs.writeFileSync('src/pages/CRM/CrmBookingDetail.tsx', c);

