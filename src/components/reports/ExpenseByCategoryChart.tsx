import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CategoryPoint {
  name: string;
  value: number;
  color: string;
}

interface ExpenseByCategoryChartProps {
  data: CategoryPoint[];
}

export const ExpenseByCategoryChart: React.FC<ExpenseByCategoryChartProps> = ({
  data,
}) => (
  <div className="rounded-xl bg-card border border-border p-5">
    <h2 className="font-heading font-semibold text-foreground text-sm mb-4">
      Expense by Category
    </h2>
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            outerRadius={80}
            innerRadius={40}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0];
              return (
                <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                  <p className="text-xs font-heading font-semibold text-foreground">
                    {d.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ₹{(d.value as number).toLocaleString("en-IN")}
                  </p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2">
        {data.map((c) => (
          <div key={c.name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: c.color }}
            />
            <span className="text-xs text-foreground">{c.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">
              ₹{(c.value / 1000).toFixed(0)}k
            </span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ExpenseByCategoryChart;
