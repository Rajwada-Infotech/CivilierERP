// Five tabs (Home, Attendance, Leave, Pay, Profile) plus pages opened from them.
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CalendarCheck, Home, Plane, User, Wallet } from "lucide-react-native";
import HomeScreen from "@/screens/home/HomeScreen";
import AttendanceScreen from "@/screens/attendance/AttendanceScreen";
import LeaveScreen from "@/screens/leave/LeaveScreen";
import PayScreen from "@/screens/pay/PayScreen";
import PayslipScreen from "@/screens/pay/PayslipScreen";
import ProfileScreen from "@/screens/profile/ProfileScreen";
import HolidaysScreen from "@/screens/profile/HolidaysScreen";
import LoginHistoryScreen from "@/screens/profile/LoginHistoryScreen";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export type MainParamList = {
  Tabs: undefined;
  Payslip: { runId: number };
  Holidays: undefined;
  LoginHistory: undefined;
};

const Stack = createNativeStackNavigator<MainParamList>();
const Tab = createBottomTabNavigator();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.heading.medium, fontSize: 10.5 },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: ({ color, size }) => <Home color={color} size={size - 2} /> }} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size - 2} /> }} />
      <Tab.Screen name="Leave" component={LeaveScreen} options={{ tabBarIcon: ({ color, size }) => <Plane color={color} size={size - 2} /> }} />
      <Tab.Screen name="Pay" component={PayScreen} options={{ title: "Payslips", tabBarIcon: ({ color, size }) => <Wallet color={color} size={size - 2} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: ({ color, size }) => <User color={color} size={size - 2} /> }} />
    </Tab.Navigator>
  );
}

export default function MainStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: fonts.heading.semibold, fontSize: 16 },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="Payslip" component={PayslipScreen} options={{ title: "Payslip" }} />
      <Stack.Screen name="Holidays" component={HolidaysScreen} options={{ title: "Holiday calendar" }} />
      <Stack.Screen name="LoginHistory" component={LoginHistoryScreen} options={{ title: "Login history" }} />
    </Stack.Navigator>
  );
}
