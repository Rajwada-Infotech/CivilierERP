// Refetch a query every time its screen regains focus, so changes made on
// the web (or another device) show up the moment you open the tab — not
// only after a manual pull-to-refresh. Skips the very first focus (the
// query already fetches on mount).
import { useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";

export function useRefetchOnFocus(refetch: () => unknown) {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) { first.current = false; return; }
      refetch();
    }, [refetch]),
  );
}
