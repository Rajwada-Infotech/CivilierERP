import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Puzzle, BarChart2, TrendingUp, PieChart, Hash, Table2, Calendar,
  Bell, MessageSquare, Map, Paperclip, RefreshCw, Calculator, X
} from "lucide-react";

const widgetItems = [
  { icon: BarChart2, label: "Bar Chart" },
  { icon: TrendingUp, label: "Line Chart" },
  { icon: PieChart, label: "Pie Chart" },
  { icon: Hash, label: "Stat Card" },
  { icon: Table2, label: "Data Table" },
  { icon: Calendar, label: "Calendar" },
  { icon: Bell, label: "Notifications" },
  { icon: MessageSquare, label: "Activity Feed" },
  { icon: Map, label: "Map View" },
  { icon: Paperclip, label: "File Uploader" },
  { icon: RefreshCw, label: "Progress Ring" },
  { icon: Calculator, label: "Calculator" },
];

const Widgets = () => {
  const [searchParams] = useSearchParams();
  const paramWidget = searchParams.get("w");
  const [selected, setSelected] = useState<string | null>(paramWidget);

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", selected || "Widgets"]} />

      {selected ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            {(() => { const w = widgetItems.find(i => i.label === selected); return w ? <w.icon size={32} className="text-primary" /> : <Puzzle size={32} className="text-primary" />; })()}
          </div>
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">{selected}</h1>
          <p className="text-muted-foreground mb-6">{selected} — Coming Soon</p>
          <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-primary hover:underline font-heading">
            <X size={14} /> Back to all widgets
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6">
            <Puzzle size={20} className="text-primary" />
            <h1 className="text-xl font-heading font-bold text-foreground">Widgets</h1>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {widgetItems.map(({ icon: Icon, label }) => (
              <button
                key={label}
                onClick={() => setSelected(label)}
                className="flex flex-col items-center gap-2 p-5 rounded-lg border border-border bg-card transition-all hover:bg-accent/10 hover:shadow-md hover:-translate-y-0.5 hover:border-primary"
              >
                <Icon size={28} className="text-primary" />
                <span className="text-xs text-muted-foreground font-heading">{label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </AppLayout>
  );
};

export default Widgets;
