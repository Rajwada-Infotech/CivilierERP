// The stock transfer form as a page of the stack, under the app's header like every other screen, rather than a sheet
// floating over the list. Create only: a transfer executes at once. Executing or Back returns.
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { StockTransferFormModal } from "./stockTransfer/StockTransferFormModal";

export default function StockTransferFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  return <StockTransferFormModal asScreen visible onClose={() => navigation.goBack()} />;
}
