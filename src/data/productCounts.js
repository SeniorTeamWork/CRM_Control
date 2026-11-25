const normalizedName = (value) => String(value || "").trim().toLocaleLowerCase("uz-UZ");

const productIdentity = (item, index) => {
  const id = item?.id ?? item?.productId;
  if (id != null && String(id).trim() !== "") return `id:${String(id).trim().toLocaleLowerCase("uz-UZ")}`;
  const name = normalizedName(item?.name || item?.productName || item?.product);
  return name ? `name:${name}` : `line:${index}`;
};

export function groupProductLines(items) {
  if (!Array.isArray(items)) return [];
  const groups = new Map();
  items.forEach((item, index) => {
    const identity = productIdentity(item, index);
    if (!groups.has(identity)) groups.set(identity, { identity, name: item?.name || "", items: [] });
    groups.get(identity).items.push(item);
  });
  return [...groups.values()];
}

/** Count catalog products once, even when good and defective units are separate sale lines. */
export function uniqueProductCount(items, fallback = 0) {
  if (!Array.isArray(items) || items.length === 0) return Math.max(0, Number(fallback) || 0);
  return groupProductLines(items).length || Math.max(0, Number(fallback) || 0);
}
