import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import CatalogScreen from "@/screens/catalog/CatalogScreen";
import CreditNotesScreen from "@/screens/creditNotes/CreditNotesScreen";
import QuotationDetailScreen from "@/screens/quotations/QuotationDetailScreen";
import OrderDetailScreen from "@/screens/orders/OrderDetailScreen";
import ReceiptDetailScreen from "@/screens/receipts/ReceiptDetailScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Profile: undefined;
  Catalog: undefined;
  CreditNotes: undefined;
  Notifications: undefined;
  QuotationDetail: { id: number };
  OrderDetail: { id: number };
  ReceiptDetail: { purchaseOrderId: number };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Dashboard/Catalog/CreditNotes are the three tabs BottomPillNav switches
// between (mirrors SupplierLayout.tsx's center pill nav on web); Profile
// is reached via the header avatar instead, same split the web nav has.
// The three *Detail screens are pushed on top from Dashboard's cards.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: "Price Catalog" }} />
      <Stack.Screen name="CreditNotes" component={CreditNotesScreen} options={{ title: "Credit Notes" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="QuotationDetail" component={QuotationDetailScreen} options={{ title: "Quotation" }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: "Order" }} />
      <Stack.Screen name="ReceiptDetail" component={ReceiptDetailScreen} options={{ title: "Receipt" }} />
    </Stack.Navigator>
  );
}
