// The debit note form as a page of the stack, under the app's header like every other screen, rather than a sheet
// floating over the list. New debit note opens it bare; Edit passes the note's id. Saving or Back returns.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { DebitNoteFormModal } from "./debitNote/DebitNoteFormModal";

export default function DebitNoteFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "DebitNoteForm">>();
  return <DebitNoteFormModal asScreen visible editingId={route.params?.id ?? null} onClose={() => navigation.goBack()} />;
}
