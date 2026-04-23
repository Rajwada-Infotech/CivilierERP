import React from "react";

interface TopParty {
  name: string;
  txns: number;
  total: number;
}

const fmt = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

interface TopPartiesTableProps {
  parties: TopParty[];
}

export const TopPartiesTable: React.FC<TopPartiesTableProps> = ({ parties }) => (
  <div className="rounded-xl bg-card border border-border p-5">
    <h2 className="font-heading font-semibold text-foreground text-sm mb-4">
      Top Parties by Volume
    </h2>
    <div className="space-y-3">
      {parties.map((p, i) => (
        <div key={p.name} className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-heading font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground font-medium truncate">
              {p.name}
            </p>
            <p className="text-xs text-muted-foreground">{p.txns} transactions</p>
          </div>
          <span className="text-sm font-heading font-semibold text-foreground">
            {fmt(p.total)}
          </span>
        </div>
      ))}
    </div>
  </div>
);

export default TopPartiesTable;
