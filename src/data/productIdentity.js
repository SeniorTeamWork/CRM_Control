// Mahsulotni bir xilligini aniqlash qoidalari:
//  - ID raqami (SKU) faqat bitta mahsulotga tegishli bo'ladi;
//  - nomi va brendi bir xil mahsulot bazada ikkinchi marta yaratilmaydi.
export const normText = (value) => String(value ?? "").trim().toLocaleLowerCase("uz-UZ").replace(/[‘’ʻʼ`]/g, "'");

const sameNameBrand = (a, b) => normText(a?.name) === normText(b?.name) && normText(a?.brand) === normText(b?.brand);

/** Shu SKU boshqa mahsulotga berilganmi? Berilgan bo'lsa o'sha mahsulotni qaytaradi. */
export function findSkuOwner(catalog, { sku, name, brand, excludeId } = {}) {
  const code = normText(sku);
  if (!code || !Array.isArray(catalog)) return null;
  // Shu SKU aynan shu mahsulotniki bo'lsa (nomi+brendi mos yoki o'zi) — xato emas.
  const ownsCode = catalog.some((product) => normText(product?.sku) === code &&
    ((excludeId != null && String(product.id) === String(excludeId)) || (normText(name) && sameNameBrand(product, { name, brand }))));
  if (ownsCode) return null;
  return catalog.find((product) =>
    normText(product?.sku) === code &&
    (excludeId == null || String(product.id) !== String(excludeId)) &&
    !sameNameBrand(product, { name, brand })
  ) || null;
}

/** Nomi va brendi bir xil boshqa mahsulot bormi? */
export function findSameNameProduct(catalog, { name, brand, excludeId } = {}) {
  if (!normText(name) || !Array.isArray(catalog)) return null;
  return catalog.find((product) =>
    (excludeId == null || String(product.id) !== String(excludeId)) && sameNameBrand(product, { name, brand })
  ) || null;
}

/** Qabul qilinayotgan tovar uchun bazadagi mos mahsulot (avval SKU, keyin nom + brend). */
export function findExistingProduct(catalog, { existingId, sku, name, brand } = {}) {
  if (!Array.isArray(catalog)) return null;
  if (existingId != null && existingId !== "") {
    const byId = catalog.find((product) => String(product.id) === String(existingId));
    if (byId) return byId;
  }
  const code = normText(sku);
  if (code) {
    const bySku = catalog.find((product) => normText(product?.sku) === code && sameNameBrand(product, { name, brand }));
    if (bySku) return bySku;
  }
  return findSameNameProduct(catalog, { name, brand });
}

export const productLabel = (product) => [product?.name, product?.brand].filter(Boolean).join(" · ") || String(product?.id ?? "");

export const skuTakenMessage = (sku, owner) => `"${sku}" ID raqami allaqachon "${productLabel(owner)}" mahsulotiga berilgan. Boshqa ID raqamini kiriting.`;

/** Bir ro'yxatda bir xil SKU har xil mahsulotlarga berilganmi? */
export function batchSkuConflict(drafts) {
  const owners = new Map();
  for (const draft of drafts) {
    const code = normText(draft.sku);
    if (!code) continue;
    const key = `${normText(draft.productName ?? draft.name)}|${normText(draft.brand)}`;
    if (owners.has(code) && owners.get(code) !== key) return `"${draft.sku}" ID raqami ro'yxatda ikki xil mahsulotga berilgan.`;
    owners.set(code, key);
  }
  return "";
}

/** Takliflar ro'yxatida bir mahsulot ikki marta chiqmasin (qoldig'i ko'prog'i qoladi). */
export function uniqueProducts(list) {
  const byKey = new Map();
  (Array.isArray(list) ? list : []).forEach((product) => {
    const key = `${normText(product?.name)}|${normText(product?.brand)}|${normText(product?.sku)}`;
    const current = byKey.get(key);
    if (!current || Number(product?.stock || 0) > Number(current?.stock || 0)) byKey.set(key, product);
  });
  return [...byKey.values()];
}
