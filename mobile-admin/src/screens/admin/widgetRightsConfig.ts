// RN port of WidgetsRights.tsx's widgetIcons map + category colors (web).
import {
  BarChart2, TrendingUp, PieChart, Hash, Table2,
  Calendar, Bell, MessageSquare, Map as MapIcon, Paperclip,
  RefreshCw, Calculator, Puzzle,
} from "lucide-react-native";

export const WIDGET_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  "bar-chart-2": BarChart2,
  "trending-up": TrendingUp,
  "pie-chart": PieChart,
  hash: Hash,
  "table-2": Table2,
  calendar: Calendar,
  bell: Bell,
  "message-square": MessageSquare,
  map: MapIcon,
  paperclip: Paperclip,
  "refresh-cw": RefreshCw,
  calculator: Calculator,
};
export const DEFAULT_WIDGET_ICON = Puzzle;

export const CATEGORY_COLORS: Record<string, string> = {
  Charts: "#3b82f6",
  KPIs: "#8b5cf6",
  Data: "#06b6d4",
  Planning: "#10b981",
  Alerts: "#f43f5e",
  Activity: "#f59e0b",
  Geo: "#14b8a6",
  Tools: "#f97316",
};
