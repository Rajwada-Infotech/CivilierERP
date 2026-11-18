// The customer side of the app (Customer Portal sign-in), laid out like the other CivilierERP apps (Employee): along
// the bottom Home, Payments, Bills, Help — and Menu, which pops up every other Customer Portal page (TopHeader.tsx
// NavMenuSheet, grouped as the web sidebar). Titles are the web portal's own menu names (PortalLayout.tsx NAV_GROUPS). Staff get MainStack instead
// (RootNavigator.tsx).
import { Tap } from "@/customer/ui";
import { Text, View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CreditCard, Home, LayoutGrid, LifeBuoy, Receipt } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { ThemeProvider, useBrand } from "@/theme/ThemeContext";
import { CustomerProvider } from "@/customer/CustomerContext";
import CustomerHomeScreen from "@/screens/customer/HomeScreen";
import CustomerPaymentsScreen from "@/screens/customer/PaymentsScreen";
import CustomerBillsScreen from "@/screens/customer/BillsScreen";
import CustomerBillScreen from "@/screens/customer/BillScreen";
import CustomerRequestsScreen from "@/screens/customer/RequestsScreen";
import CustomerConstructionScreen from "@/screens/customer/ConstructionScreen";
import CustomerDocumentsScreen from "@/screens/customer/DocumentsScreen";
import CustomerProfileScreen from "@/screens/customer/ProfileScreen";
import CustomerBookingScreen from "@/screens/customer/BookingScreen";
import CustomerTransferDeedScreen from "@/screens/customer/TransferDeedScreen";
import CustomerActivityScreen from "@/screens/customer/ActivityScreen";
import CustomerSettingsScreen from "@/screens/customer/SettingsScreen";
import { AccountMenuProvider, TopHeader, useCustomerMenus } from "./TopHeader";

/** Every customer screen by name — the tabs and the pages — so any screen can open any other (and a notification can). */
export type CustomerStackParamList = {
  CustomerTabs: undefined;
  CustomerHome: undefined;
  CustomerPayments: undefined;
  CustomerBills: undefined;
  CustomerRequests: undefined;
  CustomerProfile: undefined;
  CustomerSettings: undefined;
  CustomerBill: { billId: number };
  CustomerBooking: undefined;
  CustomerConstruction: undefined;
  CustomerDocuments: undefined;
  CustomerTransferDeed: undefined;
  CustomerActivity: undefined;
};

const Stack = createNativeStackNavigator<CustomerStackParamList>();
const Tab = createBottomTabNavigator<CustomerStackParamList>();

const TABS = [
  { name: "CustomerHome", title: "Home", label: "Home", icon: Home, component: CustomerHomeScreen },
  { name: "CustomerPayments", title: "Payments", label: "Payments", icon: CreditCard, component: CustomerPaymentsScreen },
  { name: "CustomerBills", title: "My Bills", label: "Bills", icon: Receipt, component: CustomerBillsScreen },
  { name: "CustomerRequests", title: "Help & Support", label: "Help", icon: LifeBuoy, component: CustomerRequestsScreen },
] as const;

/** A floating, rounded tab bar: the active tab sits in an accent pill with its label; the others are icons + labels.
 * Floats over content, so Page leaves TAB_BAR_CLEARANCE at the bottom. */
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const b = useBrand();
  const menus = useCustomerMenus();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 10) + 6, paddingHorizontal: 14 }}>
      <View style={{
        flexDirection: "row", alignItems: "center", height: 68, borderRadius: 26, paddingHorizontal: 6,
        backgroundColor: b.isDark ? "#1C1C25" : "#FFFFFF", borderWidth: 1, borderColor: b.border,
        shadowColor: "#000", shadowOpacity: b.isDark ? 0.5 : 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 14,
      }}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const tab = TABS.find((x) => x.name === route.name);
          if (!tab) return null;
          const onPress = () => {
            const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigation.navigate(route.name as never);
          };
          return (
            <Tap key={route.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }}
              accessibilityLabel={descriptors[route.key].options.title}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 56 }}>
              <View style={{ alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18,
                backgroundColor: focused ? b.goldSoft : "transparent" }}>
                <tab.icon size={21} color={focused ? b.gold : b.textFaint} strokeWidth={focused ? 2.3 : 1.9} />
                <Text style={{ fontSize: 11, fontFamily: focused ? fonts.heading.semibold : fonts.body.medium, color: focused ? b.gold : b.textSecondary }}>{tab.label}</Text>
              </View>
            </Tap>
          );
        })}
        {/* Menu: not a page of its own — it pops up the rest of the portal's pages. */}
        <Tap onPress={menus.nav} accessibilityRole="button" accessibilityLabel="Menu — more pages"
          style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 56 }}>
          <View style={{ alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18 }}>
            <LayoutGrid size={21} color={b.textFaint} strokeWidth={1.9} />
            <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: b.textSecondary }}>Menu</Text>
          </View>
        </Tap>
      </View>
    </View>
  );
}

function CustomerTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        header: (props) => <TopHeader {...(props as unknown as NativeStackHeaderProps)} />,
        headerTransparent: true,
      }}
    >
      {TABS.map((t) => (
        <Tab.Screen key={t.name} name={t.name} component={t.component}
          options={{ title: t.title, tabBarLabel: t.label, tabBarIcon: ({ color, size }) => <t.icon color={color} size={size} /> }} />
      ))}
    </Tab.Navigator>
  );
}

export default function CustomerStack() {
  return (
    <ThemeProvider>
      <CustomerProvider>
        <AccountMenuProvider>
        <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} />, headerTransparent: true, contentStyle: { backgroundColor: "transparent" } }}>
          <Stack.Screen name="CustomerTabs" component={CustomerTabs} options={{ headerShown: false }} />
          <Stack.Screen name="CustomerBooking" component={CustomerBookingScreen} options={{ title: "My Bookings" }} />
          <Stack.Screen name="CustomerConstruction" component={CustomerConstructionScreen} options={{ title: "Construction" }} />
          <Stack.Screen name="CustomerDocuments" component={CustomerDocumentsScreen} options={{ title: "Documents" }} />
          <Stack.Screen name="CustomerTransferDeed" component={CustomerTransferDeedScreen} options={{ title: "Transfer Deed" }} />
          <Stack.Screen name="CustomerActivity" component={CustomerActivityScreen} options={{ title: "Updates" }} />
          <Stack.Screen name="CustomerBill" component={CustomerBillScreen} options={{ title: "Bill" }} />
          <Stack.Screen name="CustomerSettings" component={CustomerSettingsScreen} options={{ title: "Settings" }} />
          <Stack.Screen name="CustomerProfile" component={CustomerProfileScreen} options={{ title: "My Profile" }} />
        </Stack.Navigator>
        </AccountMenuProvider>
      </CustomerProvider>
    </ThemeProvider>
  );
}
