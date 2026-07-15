import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Home, Bell, User } from "lucide-react-native";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";

export type MainTabParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// Bottom-tab shell mirroring the web app's module-switcher intent (Phase 7
// in the plan) — one tab per top-level surface. Add module tabs/stacks here
// (Finance, Procurement, CRM...) as each is ported, gated the same way the
// web sidebar is gated: by usePageRights()/canAccessPage() per screen.
export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#6b7280",
        tabBarStyle: { backgroundColor: "#111826", borderTopColor: "#1f2937" },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ tabBarIcon: ({ color, size }) => <Bell color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}
