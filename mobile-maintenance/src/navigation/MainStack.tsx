import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import MenuScreen from "@/screens/menu/MenuScreen";
import { TopHeader } from "./TopHeader";

// Scaffold state — only Dashboard/Menu/Profile/Notifications exist so far
// (auth, theme, navigation shell, and shared components ported from
// mobile-Fixed-Asset; API clients for Directory/Bills/Security
// Attendance/Electricity Maintenance are already written in src/api/**).
// Add each module's real screens here as they're built — see README.md
// "Adding a screen".
export type MainStackParamList = {
  Dashboard: undefined;
  Menu: undefined;
  Profile: undefined;
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Menu" component={MenuScreen} options={{ title: "Menu" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
    </Stack.Navigator>
  );
}
