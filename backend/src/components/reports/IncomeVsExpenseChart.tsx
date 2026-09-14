import React from "react";
import { formatINR } from "@/utils/formatCurrency";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
}

interface IncomeVsExpenseChartProps {
  data: MonthlyPoint[];
}

export const IncomeVsExpenseChart: React.FC<IncomeVsExpenseChartProps> = ({
  data,
}) => (
  <div className="rounded-xl bg-card border border-border p-5">
    <h2 className="font-heading font-semibold text-foreground text-sm mb-4">
      Income vs Expenses (6 Months)
    </h2>
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="month"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickFormatter={(v) => formatINR(v / 1000).replace("₹", "") + "k"}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--foreground))",
          }}
          formatter={(value: number) => [formatINR(value), ""]}
        />
        <Bar
          dataKey="income"
          fill="hsl(142, 71%, 45%)"
          radius={[4, 4, 0, 0]}
          name="Income"
        />
        <Bar
          dataKey="expense"
          fill="hsl(0, 72%, 51%)"
          radius={[4, 4, 0, 0]}
          name="Expense"
        />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default IncomeVsExpenseChart;
