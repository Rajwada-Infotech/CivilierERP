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
import MaterialDashboardScreen from "@/screens/material/MaterialDashboardScreen";
import VehicleInOutListScreen from "@/screens/material/VehicleInOutListScreen";
import PurchaseOrderListScreen from "@/screens/material/PurchaseOrderListScreen";
import ContractListScreen from "@/screens/finance/ContractListScreen";
import ContractDetailScreen from "@/screens/finance/ContractDetailScreen";
import NewContractScreen from "@/screens/finance/NewContractScreen";
import JournalVoucherScreen from "@/screens/finance/JournalVoucherScreen";
import TrialBalanceScreen from "@/screens/finance/TrialBalanceScreen";
import NewInvoiceScreen from "@/screens/finance/NewInvoiceScreen";
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
  MaterialDashboard: undefined;
  VehicleInOut: undefined;
  PurchaseOrder: undefined;
  Contract: undefined;
  ContractDetail: { id: number };
  NewContract: { id?: number } | undefined;
  JournalVoucher: undefined;
  TrialBalance: undefined;
  NewInvoice: { id?: string } | undefined;
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
      <Stack.Screen name="MaterialDashboard" component={MaterialDashboardScreen} options={{ title: "Material" }} />
      <Stack.Screen name="VehicleInOut" component={VehicleInOutListScreen} options={{ title: "Vehicle In/Out" }} />
      <Stack.Screen name="PurchaseOrder" component={PurchaseOrderListScreen} options={{ title: "Purchase Orders" }} />
      <Stack.Screen name="Contract" component={ContractListScreen} options={{ title: "Contracts" }} />
      <Stack.Screen name="ContractDetail" component={ContractDetailScreen} options={{ title: "Contract" }} />
      <Stack.Screen name="NewContract" component={NewContractScreen} options={{ title: "New Contract" }} />
      <Stack.Screen name="JournalVoucher" component={JournalVoucherScreen} options={{ title: "Journal Voucher" }} />
      <Stack.Screen name="TrialBalance" component={TrialBalanceScreen} options={{ title: "Trial Balance" }} />
      <Stack.Screen name="NewInvoice" component={NewInvoiceScreen} options={{ title: "New Invoice" }} />
    </Stack.Navigator>
  );
}
