import { orderReturnBalance } from "../data/supplierReturns";
import { useState } from "react";
import { CreditCard, Search, Truck, Package } from "lucide-react";
import { getData, useDataVersion } from "../supabase/db";
import { useLanguage } from "../context/LanguageContext";
import { translateText as tx } from "../locales/translateText";
import { formatCurrency } from "../data/currency";
import "./OurDebts.css";

const read = (key) => {
  const value = getData(key, []);
  return Array.isArray(value) ? value : [];
};

// Match SupplierDetail's order, return and legacy balance rules.
export function supplierBalance(supplier, orders, returns) {
  const balances = orders.map(order => orderReturnBalance(order, returns));
  const orderBalance = balances.reduce((sum, value) => sum + value, 0);
  const legacy = Math.max(Number(supplier.legacyDebt || 0), Math.max(0, Number(supplier.debt || 0) - orderBalance));
  return { debt: orderBalance + legacy, unpaidOrders: balances.filter((value) => value > 0).length };
}

export default function OurDebts({ onNavigate }) {
  useLanguage();
  useDataVersion();
  const [query, setQuery] = useState("");
  const returns = read("crm_supplier_returns");
  const rows = read("crm_suppliers").map((supplier) => ({
    ...supplier,
    ...supplierBalance(supplier, read(`crm_supplier_orders_${supplier.id}`), returns.filter((item) => String(item.supplierId) === String(supplier.id))),
  })).filter((supplier) => supplier.debt > 0).sort((a, b) => b.debt - a.debt);
  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => [row.name, row.phone, row.address].some((value) => String(value || "").toLocaleLowerCase().includes(search)));
  const cards = [
    [CreditCard, "Jami qarzimiz", formatCurrency(rows.reduce((sum, row) => sum + row.debt, 0))],
    [Truck, "Qarzdor bo‘lgan ta’minotchilar", rows.length],
    [Package, "Qarzi qolgan buyurtmalar", rows.reduce((sum, row) => sum + row.unpaidOrders, 0)],
  ];
  return <div className="our-debts">
    <header><h1>{tx("Biz qarzdor")}</h1><p>{tx("Ta’minotchilarga bo‘lgan qarzlarimiz")}</p></header>
    <div className="our-debts-summary">{cards.map(([Icon, title, value]) => <div className="card our-debts-stat" key={title}><Icon size={20}/><strong>{value}</strong><span>{tx(title)}</span></div>)}</div>
    <section className="card our-debts-list">
      <div className="our-debts-toolbar"><label><Search size={17}/><input className="input-base" aria-label={tx("Ism yoki telefon")} placeholder={tx("Ism yoki telefon...")} value={query} onChange={(event) => setQuery(event.target.value)}/></label><span>{filtered.length} {tx("ta natija")}</span></div>
      <div className="our-debts-scroll"><table><thead><tr>{["Ta'minotchi", "Telefon", "Qarzi qolgan buyurtmalar", "Qolgan qarz", "Tafsilotlar"].map((title) => <th key={title}>{tx(title)}</th>)}</tr></thead><tbody>
        {filtered.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.address || "—"}</small></td><td>{row.phone || "—"}</td><td>{row.unpaidOrders}</td><td className="our-debts-amount">{formatCurrency(row.debt)}</td><td><button className="btn-secondary" onClick={() => onNavigate(`supplier-${row.id}`)}>{tx("Ko‘rish")} →</button></td></tr>)}
        {!filtered.length && <tr><td colSpan={5} className="our-debts-empty">{tx(query ? "Qidiruv bo‘yicha natija topilmadi" : "Ta’minotchilarga qarzimiz mavjud emas")}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
