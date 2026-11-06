// The purchase order form as a page of the stack, under the app's header like every other screen, rather than a sheet
// floating over the list. New order opens it bare; Edit passes the order's id; an L1 Chart award passes its prefill.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { PurchaseOrderFormModal } from "./purchaseOrder/PurchaseOrderFormModal";

export default function PurchaseOrderFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "PurchaseOrderForm">>();
  return (
    <PurchaseOrderFormModal
      asScreen
      visible
      editingId={route.params?.id ?? null}
      qtPrefill={route.params?.qtPrefill ?? null}
      onClose={() => navigation.goBack()}
    />
  );
}
