import React from "react";
import { formatINR } from "@/utils/formatCurrency";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CashFlowPoint {
  month: string;
  balance: number;
}

interface CashFlowChartProps {
  data: CashFlowPoint[];
}

export const CashFlowChart: React.FC<CashFlowChartProps> = ({ data }) => (
  <div className="rounded-xl bg-card border border-border p-5">
    <h2 className="font-heading font-semibold text-foreground text-sm mb-4">
      Cash Flow Trend
    </h2>
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="month"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickFormatter={(v) => formatINR(v / 100000).replace("₹", "") + "L"}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--foreground))",
          }}
          formatter={(value: number) => [formatINR(value), "Balance"]}
        />
        <Line
          type="monotone"
          dataKey="balance"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={{ fill: "hsl(var(--primary))", r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
);

export default CashFlowChart;
