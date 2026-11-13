import { getData, setData } from "../supabase/db";
const KEY = "crm_customer_orders_v1";
export const defectReservationKey = (productId, defectId) => `${String(productId)}::${String(defectId)}`;

export function readOrders() {
  try {
    const value = getData(KEY, []);
    return Array.isArray(value) ? value.filter((order) => order && order.id && Array.isArray(order.cart)) : [];
  } catch {
    return [];
  }
}

export function saveOrder(order) {
  try {
    const orders = readOrders();
    const next = orders.some((item) => String(item.id) === String(order.id))
      ? orders.map((item) => String(item.id) === String(order.id) ? order : item)
      : [order, ...orders];
    setData(KEY, next);
    window.dispatchEvent(new Event("crm-orders-updated"));
    return true;
  } catch {
    return false;
  }
}

export function removeOrder(orderId) {
  try {
    setData(KEY, readOrders().filter((order) => String(order.id) !== String(orderId)));
    window.dispatchEvent(new Event("crm-orders-updated"));
    return true;
  } catch {
    return false;
  }
}

export function reservedQuantities(excludeOrderId = null, orders = readOrders()) {
  return orders.reduce((reserved, order) => {
    if (order.status !== "reserved" || String(order.id) === String(excludeOrderId)) return reserved;
    (order.cart || []).forEach((item) => {
      const id = String(item.id);
      reserved[id] = (reserved[id] || 0) + Math.max(0, Number(item.qty) || 0);
    });
    return reserved;
  }, {});
}

export function reservedQuantitiesByCondition(excludeOrderId = null, orders = readOrders()) {
  return orders.reduce((reserved, order) => {
    if (order.status !== "reserved" || String(order.id) === String(excludeOrderId)) return reserved;
    (order.cart || []).forEach((item) => {
      const id = String(item.id);
      const itemCondition = String(item.condition || item.stockCondition || item.kind || "").toLocaleLowerCase("uz-UZ");
      const condition = item.isDefectSale || item.isDefective || item.defectId || ["defective", "defect", "brak", "yaroqsiz"].includes(itemCondition) ? "defective" : "good";
      reserved[condition][id] = (reserved[condition][id] || 0) + Math.max(0, Number(item.qty) || 0);
      if (condition === "defective" && item.defectId != null) {
        const key = defectReservationKey(id, item.defectId);
        reserved.defectiveLots[key] = (reserved.defectiveLots[key] || 0) + Math.max(0, Number(item.qty) || 0);
      }
    });
    return reserved;
  }, { good: {}, defective: {}, defectiveLots: {} });
}
