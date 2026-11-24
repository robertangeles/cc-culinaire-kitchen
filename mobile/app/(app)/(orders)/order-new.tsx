import { OrderForm } from "../../../src/orders/OrderForm";
import { useOrders } from "../../../src/orders/OrdersProvider";

/** Write a purchase order. It stays on the phone, to come back to, until it is saved. */
export default function OrderNew() {
  return <OrderForm store={useOrders().draft} title="New order" />;
}
