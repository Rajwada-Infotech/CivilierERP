// The payment form as a page of the stack — under the app's header, like every other screen — rather than a sheet
// floating over the list. New payment opens it bare; Edit passes the saved record; BRS's "Re-issue" passes the bounced
// payment's context. Saving or Back returns to wherever it was opened from.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { PaymentFormModal } from "./payment/PaymentFormModal";

export default function PaymentFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "PaymentForm">>();
  return (
    <PaymentFormModal
      asScreen
      visible
      onClose={() => navigation.goBack()}
      editingRecord={route.params?.record ?? null}
      reissueContext={route.params?.reissue ?? null}
    />
  );
}
