const normalizedName = (value) => String(value ?? "").trim().toLocaleLowerCase("uz-UZ");
const firstNonEmpty = (...values) => values.find((value) => value != null && String(value).trim() !== "");

const lineProductId = (line) => firstNonEmpty(line?.productId, line?.product?.id, line?.id);
const lineProductName = (line) => firstNonEmpty(line?.productName, line?.product?.name, line?.name, typeof line?.product === "string" ? line.product : "");
const lineSupplierId = (line) => firstNonEmpty(line?.supplierId, line?.taminotchiId, line?.supplier?.id);
const lineSupplierName = (line) => firstNonEmpty(line?.supplierName, typeof line?.supplier === "string" ? line.supplier : line?.supplier?.name);

const uniqueLines = (lines) => {
  const byProduct = new Map();
  lines.forEach((line) => {
    const id = lineProductId(line);
    const name = normalizedName(lineProductName(line));
    if (id == null && !name) return;
    const key = id != null ? `id:${String(id)}` : `name:${name}`;
    if (!byProduct.has(key)) byProduct.set(key, { ...line, id: id ?? line?.id, name: lineProductName(line) || line?.name });
  });
  return [...byProduct.values()];
};

/**
 * Return distinct catalog products received from a supplier. Supplier-scoped
 * orders are authoritative; aggregate receipt rows are a fallback only when
 * those orders have no product details, preventing cross-supplier leakage.
 */
export function supplierReceivedProductData(supplier, catalog = [], orders = [], receipts = []) {
  const supplierId = String(supplier?.id ?? "");
  const supplierName = normalizedName(supplier?.name);
  const receivedOrders = orders.filter((order) =>
    order?.received !== false && !String(order?.id || "").startsWith("PO-LEGACY-")
  );
  const orderIds = new Set(receivedOrders.flatMap((order) => [order?.id, order?.orderId]).filter(Boolean).map(String));

  const orderLines = receivedOrders.flatMap((order) => {
    const details = Array.isArray(order?.productDetails)
      ? order.productDetails
      : Array.isArray(order?.products) ? order.products : [];
    if (details.length) return details;
    const ids = Array.isArray(order?.productIds) ? order.productIds : [];
    if (ids.length) return ids.map((id) => ({ id }));
    return (Array.isArray(order?.productNames) ? order.productNames : []).map((name) => ({ name }));
  }).filter((line) => {
    const lineId = lineSupplierId(line);
    const lineName = normalizedName(lineSupplierName(line));
    if (lineId != null && String(lineId) !== supplierId) return false;
    if (lineName && supplierName && lineName !== supplierName) return false;
    return lineProductId(line) != null || Boolean(normalizedName(lineProductName(line)));
  });

  let lines = orderLines;
  if (!lines.length) {
    lines = receipts.flatMap((receipt) => {
      const receiptSupplierIds = [
        ...(Array.isArray(receipt?.supplierIds) ? receipt.supplierIds : []),
        ...(receipt?.supplierId != null ? [receipt.supplierId] : []),
      ].map(String);
      if (!receiptSupplierIds.includes(supplierId)) return [];

      const receiptOrderIds = [receipt?.orderId, ...(Array.isArray(receipt?.orderIds) ? receipt.orderIds : [])].filter(Boolean).map(String);
      const oneLinkedSupplierOrder = receiptOrderIds.length === 1 && orderIds.has(receiptOrderIds[0]);
      const singleSupplierReceipt = new Set(receiptSupplierIds).size === 1;
      return (Array.isArray(receipt?.products) ? receipt.products : []).filter((line) => {
        const lineId = lineSupplierId(line);
        const lineName = normalizedName(lineSupplierName(line));
        if (lineId != null) return String(lineId) === supplierId;
        if (lineName) return Boolean(supplierName) && lineName === supplierName;
        return singleSupplierReceipt || oneLinkedSupplierOrder;
      });
    });
  }

  const distinctLines = uniqueLines(lines);
  const ids = new Set(distinctLines.map(lineProductId).filter((id) => id != null).map(String));
  const namesWithoutId = new Set(distinctLines.filter((line) => lineProductId(line) == null).map((line) => normalizedName(lineProductName(line))).filter(Boolean));
  const productsById = new Map();
  const includedNamesWithoutId = new Set();
  const supplierMatches = (product) => {
    const productSupplierId = firstNonEmpty(product?.supplierId, product?.taminotchiId);
    const productSupplierName = normalizedName(firstNonEmpty(product?.supplierName, product?.supplier?.name));
    return (productSupplierId != null && String(productSupplierId) === supplierId) || (supplierName && productSupplierName === supplierName);
  };
  catalog.forEach((product) => {
    const id = String(product?.id ?? "");
    if (ids.has(id) && !productsById.has(id)) {
      productsById.set(id, product);
    }
  });
  namesWithoutId.forEach((name) => {
    if (includedNamesWithoutId.has(name)) return;
    const candidates = catalog.filter((product) => normalizedName(product?.name) === name);
    const product = candidates.find(supplierMatches) || candidates[0];
    if (!product) return;
    const id = String(product.id ?? name);
    if (!productsById.has(id)) productsById.set(id, product);
    includedNamesWithoutId.add(name);
  });

  return { lines: distinctLines, products: [...productsById.values()] };
}
