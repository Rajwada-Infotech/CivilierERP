import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import FinanceDashboardScreen from "@/screens/finance/FinanceDashboardScreen";
import PaymentListScreen from "@/screens/finance/PaymentListScreen";
import OnAccountAdjustmentScreen from "@/screens/finance/OnAccountAdjustmentScreen";
import ReceivedPaymentListScreen from "@/screens/finance/ReceivedPaymentListScreen";
import BrsScreen from "@/screens/finance/BrsScreen";
import InvoiceScreen from "@/screens/finance/InvoiceScreen";
import InvoicePreviewScreen from "@/screens/finance/InvoicePreviewScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
  FinanceDashboard: undefined;
  // openForm: true jumps straight into the New Payment form on mount —
  // used by FinanceDashboardScreen's "New Payment" quick action.
  Payment: { openForm?: boolean } | undefined;
  OnAccountAdjustment: undefined;
  ReceivedPayment: { openForm?: boolean } | undefined;
  Brs: undefined;
  Invoice: undefined;
  InvoicePreview: { id: string };
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
      <Stack.Screen name="Payment" component={PaymentListScreen} options={{ title: "Payments" }} />
      <Stack.Screen name="OnAccountAdjustment" component={OnAccountAdjustmentScreen} options={{ title: "On A/C Adjustment" }} />
      <Stack.Screen name="ReceivedPayment" component={ReceivedPaymentListScreen} options={{ title: "Received Payments" }} />
      <Stack.Screen name="Brs" component={BrsScreen} options={{ title: "BRS" }} />
      <Stack.Screen name="Invoice" component={InvoiceScreen} options={{ title: "Invoice" }} />
      <Stack.Screen name="InvoicePreview" component={InvoicePreviewScreen} options={{ title: "Invoice Preview" }} />
    </Stack.Navigator>
  );
}
