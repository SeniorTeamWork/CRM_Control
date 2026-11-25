export const returnKeyFor = (saleId, itemId, index) => `${saleId}:${itemId ?? "item"}:${index}`;
export const returnedQuantityFor = (records, key, quantity, item = null) => {
  const matchingReturns = records.filter((record) => record.returnKey === key && record.status === "approved");
  const returnedInHistory = matchingReturns.reduce((sum, record) => sum + Number(
    record.quantity ?? (Number(record.goodQuantity || 0) + Number(record.defectiveQuantity || 0))
  ), 0);
  // Precise return records belong to one sold line. Only fall back to the
  // legacy all-returned flag when no matching history exists.
  const legacyReturned = matchingReturns.length === 0 && item?.returned ? quantity : 0;
  return Math.min(quantity, Math.max(returnedInHistory, Number(item?.returnedQuantity || 0), legacyReturned));
};

export { startsWithCapital } from "./posHelpers";
