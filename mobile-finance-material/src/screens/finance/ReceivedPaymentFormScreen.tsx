// The received-payment form as a page of the stack — under the app's header, like every other screen — rather than a
// sheet over the list. New receipt opens it bare; Edit passes the saved record. Saving or Back returns to the list.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ReceivedPaymentFormModal } from "./receivedPayment/ReceivedPaymentFormModal";

export default function ReceivedPaymentFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "ReceivedPaymentForm">>();
  return <ReceivedPaymentFormModal asScreen visible onClose={() => navigation.goBack()} editingRecord={route.params?.record ?? null} />;
}
