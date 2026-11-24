import { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { OrderForm } from "../../../src/orders/OrderForm";
import { useOrders } from "../../../src/orders/OrdersProvider";

/** Change a saved draft (`?poId=`). */
export default function OrderEdit() {
  const { poId } = useLocalSearchParams<{ poId?: string | string[] }>();
  const id = (Array.isArray(poId) ? poId[0] : poId) ?? "";
  const { editDraft } = useOrders();
  const store = useMemo(() => editDraft(id), [editDraft, id]);
  return <OrderForm store={store} title="Change order" editing />;
}
