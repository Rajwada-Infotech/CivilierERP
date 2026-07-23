import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import FinanceDashboardScreen from "@/screens/finance/FinanceDashboardScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
  FinanceDashboard: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Stack, not tabs — navigation now happens through the FAB + bottom sheet
// (NavSheet.tsx), matching the web app's MobileNav.tsx pattern (a floating
// trigger that opens a full nav panel) instead of a persistent tab bar.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="FinanceDashboard" component={FinanceDashboardScreen} options={{ title: "Finance" }} />
    </Stack.Navigator>
  );
}
