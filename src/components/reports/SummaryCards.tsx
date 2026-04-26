import React from "react";
import { TrendingUp, FileText, IndianRupee, PieChart as PieChartIcon } from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";

interface ReportsSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  transactionCount: number;
}

const fmt = (n: number) => formatINR(n);

interface SummaryCardsProps {
  summary: ReportsSummary;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ summary }) => {
  const cards = [
    {
      label: "Total Income",
      value: fmt(summary.totalIncome),
      icon: IndianRupee,
      color: "hsl(142, 71%, 45%)",
    },
    {
      label: "Total Expenses",
      value: fmt(summary.totalExpenses),
      icon: TrendingUp,
      color: "hsl(0, 72%, 51%)",
    },
    {
      label: "Net Profit",
      value: fmt(summary.netProfit),
      icon: FileText,
      color: "hsl(var(--primary))",
    },
    {
      label: "Transactions",
      value: String(summary.transactionCount),
      icon: PieChartIcon,
      color: "hsl(var(--secondary))",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {cards.map((s) => (
        <div
          key={s.label}
          className="rounded-xl bg-card border border-border p-4 flex items-center gap-4"
          style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
        >
          <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
            <s.icon size={20} style={{ color: s.color }} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
            <p className="text-base sm:text-lg font-heading font-bold text-foreground">
              {s.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SummaryCards;
