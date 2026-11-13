import { useEffect, useMemo, useState } from "react";
import { Search, ShoppingCart } from "lucide-react";
import DateRangeFilter, { matchesDateRange } from "../components/DateRangeFilter";
import SalesProductFilter from "../components/SalesProductFilter";
import { formatCurrency } from "../data/currency";
import { normalizeProductText, saleMatchesProduct } from "../data/salesProductFilter";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { translateText as tx } from "../locales/translateText";
import { getProducts } from "../supabase/bolimlar/mahsulotlar";
import "./Returns.css";

const readProducts = () => {
  try {
    const products = getProducts();
    return Array.isArray(products) ? products : [];
  } catch {
    return [];
  }
};

export default function DefectiveProducts({ onSellDefect }) {
  useUILanguage();
  const [products, setProducts] = useState(readProducts);
  const [categoryFilter, setCategoryFilter] = useState({ category: "", product: null, query: "" });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const refresh = () => setProducts(readProducts());
    window.addEventListener("crm-products-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("crm-products-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const defectiveItems = useMemo(() => products.flatMap((product) => {
    const defects = Array.isArray(product.defects) ? product.defects : [];
    const recordedQuantity = defects.reduce((sum, defect) => sum + Math.max(0, Number(defect.quantity) || 0), 0);
    const unrecordedQuantity = Math.max(0, Number(product.defectiveStock || 0) - recordedQuantity);
    const rows = defects.map((defect, index) => ({
      id: defect.id || `${product.id}-defect-${index}`,
      productId: product.id,
      product: defect.product || product.name,
      category: defect.category || product.category || "—",
      quantity: Number(defect.quantity) || 0,
      reason: defect.reason || "Sabab ko'rsatilmagan",
      status: defect.status || "Brak",
      unitPrice: Number(defect.unitPrice ?? defect.price ?? product.price ?? product.cost ?? 0),
      total: Number(defect.total) || Number(defect.unitPrice ?? defect.price ?? product.price ?? product.cost ?? 0) * (Number(defect.quantity) || 0),
      date: defect.date || product.createdAt || "",
    }));
    if (unrecordedQuantity > 0) rows.push({
      id: `${product.id}-defect-unrecorded`,
      productId: product.id,
      product: product.name,
      category: product.category || "—",
      quantity: unrecordedQuantity,
      reason: "Sabab ko'rsatilmagan",
      status: "Brak",
      unitPrice: Number(product.price ?? product.cost ?? 0),
      total: unrecordedQuantity * Number(product.price ?? product.cost ?? 0),
      date: product.createdAt || "",
    });
    return rows;
  }).filter((row) => row.quantity > 0), [products]);
  const query = normalizeProductText(search);
  const filtered = defectiveItems.filter((item) => {
    const values = [item.productId, item.id, item.product, item.category, item.reason];
    const matchesText = values.some((value) => normalizeProductText(value).includes(query));
    const date = new Date(item.date || "");
    const day = Number.isNaN(date.getTime()) ? String(item.date || "").slice(0, 10) : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return (matchesText || !query) && saleMatchesProduct({ items: [{ id: item.productId, name: item.product, category: item.category }] }, products, categoryFilter) && matchesDateRange(day, dateFrom, dateTo);
  });

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const thisMonth = today.slice(0, 7);
  const monthlyQuantity = defectiveItems.filter((item) => String(item.date || "").slice(0, 7) === thisMonth).reduce((sum, item) => sum + item.quantity, 0);
  const totalQuantity = defectiveItems.reduce((sum, item) => sum + item.quantity, 0);
  const todayQuantity = defectiveItems.filter((item) => {
    const date = new Date(item.date || "");
    const normalized = Number.isNaN(date.getTime()) ? String(item.date || "").slice(0, 10) : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return normalized === today;
  }).reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = defectiveItems.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-primary-color">{tx("Brak mahsulotlar")}</h1>
          <p className="text-sm mt-0.5 text-muted-color">{tx("Brak deb belgilangan tovarlar va qaydlar")}</p>
        </div>
      </div>

      <div className="returns-stats grid grid-cols-4 gap-4">
        {[
          { label: "Shu oydagi brak mahsulotlar", value: monthlyQuantity, color: "var(--brand)" },
          { label: "Jami brak mahsulotlar", value: totalQuantity, color: "var(--success)" },
          { label: "Bugungi brak mahsulotlar", value: todayQuantity, color: "var(--warning)" },
          { label: "Umumiy brak summasi", value: formatCurrency(totalValue), color: "var(--danger)" },
        ].map((stat) => (
          <div key={stat.label} className="returns-stat-card card p-4">
            <div className="returns-stat-value text-xl font-display font-bold mb-1" style={{ color: stat.color }}>{tx(stat.value)}</div>
            <div className="returns-stat-label text-xs text-faint-color">{tx(stat.label)}</div>
          </div>
        ))}
      </div>

      <div className="returns-table-card card-flat rounded-2xl">
        <div className="returns-filter-toolbar px-5 py-4 border-b-subtle">
          <div className="search-box-wrapper flex items-center gap-2 rounded-xl px-3 py-2.5 flex-1">
            <Search size={14} className="text-faint-color" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={tx("Brak mahsulotlarni qidirish")}
              placeholder={tx("Mahsulot, kategoriya yoki ID...")}
              className="bg-transparent outline-none text-sm flex-1 text-primary-color"
            />
          </div>
          <SalesProductFilter products={products} value={categoryFilter} onChange={setCategoryFilter} />
          <div className="returns-date-filter"><DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} /></div>
        </div>

        <div className="returns-table-scroll" role="region" aria-label={tx("Brak mahsulotlar jadvali")} tabIndex="0">
          <table className="returns-table w-full">
            <thead>
              <tr className="table-header-row">
                {["ID", "Mahsulot", "Kategoriya", "Miqdor", "Sabab", "Summa", "Sana", "Holat", "Amal"].map((heading) => (
                  <th key={heading} className="text-left px-5 py-3 text-xs font-semibold text-faint-color">{tx(heading)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-color">{tx("Brak mahsulotlar topilmadi")}</td></tr> : filtered.map((item) => (
                <tr key={item.id} className="border-t border-subtle">
                  <td className="px-5 py-3 text-xs text-muted-color">{item.productId ?? "—"}</td>
                  <td className="px-5 py-3 text-sm font-medium text-primary-color">{tx(item.product)}</td>
                  <td className="px-5 py-3 text-sm text-secondary-color">{tx(item.category)}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-primary-color">{tx(item.quantity)}{tx(item.measurementUnit || products.find((product) => String(product.id) === String(item.productId))?.measurementUnit || (products.find((product) => String(product.id) === String(item.productId))?.measurementType === "weight" ? " kg" : " dona"))}</td>
                  <td className="px-5 py-3 text-sm text-secondary-color"><span>{tx(item.reason)}</span><span className="block text-xs text-faint-color">{tx(item.status)}</span></td>
                  <td className="px-5 py-3 text-sm font-medium text-primary-color">{formatCurrency(item.total)}</td>
                  <td className="px-5 py-3 text-sm text-secondary-color">{item.date ? new Date(item.date).toLocaleDateString("uz-UZ") : "—"}</td>
                  <td className="px-5 py-3"><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{tx(item.status)}</span></td>
                  <td className="px-5 py-3"><button type="button" className="btn-primary text-xs justify-center" onClick={() => onSellDefect?.({ ...item, defectId: String(item.id), defectPrice: item.unitPrice })} disabled={!item.quantity || item.unitPrice < 0}><ShoppingCart size={14} />{tx("Sotish")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
