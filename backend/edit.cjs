const fs = require('fs');
let c = fs.readFileSync('src/pages/CRM/CrmPaymentMilestones.tsx', 'utf8');
const search =     { accessorKey: "AmountDue", header: "Amount Due", size: 120,
      cell: (i) => (
        <span className="font-semibold">
          {fmt(i.row.original.AmountDue)}
          {i.row.original.Percent != null && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">({Number(i.row.original.Percent)}%)</span>
          )}
        </span>
      ) },;

const replacement =     { accessorKey: "AmountDue", header: "Amount Due", size: 120,
      cell: (i) => {
        const due = Number(i.row.original.AmountDue || 0);
        const gstRate = i.row.original.ExtraChargeId ? 18 : Number(booking?.UnitParkingGstRate || 0);
        const prin = due / (1 + gstRate / 100);
        const gst = due - prin;
        return (
          <div className="font-semibold">
            {fmt(due)}
            {i.row.original.Percent != null && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">({Number(i.row.original.Percent)}%)</span>
            )}
            {due > 0 && (
              <div className="text-[10px] text-muted-foreground font-normal leading-tight mt-0.5">
                Prin {fmt(prin)}<br/>
                GST {fmt(gst)}
              </div>
            )}
          </div>
        );
      } },;

c = c.replace(search, replacement);
fs.writeFileSync('src/pages/CRM/CrmPaymentMilestones.tsx', c);

