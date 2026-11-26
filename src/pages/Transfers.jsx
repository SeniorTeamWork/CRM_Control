// "Qarzdagi tovar" — omborda yetmagan va qo'shnidan olib sotilgan tovarlar.
// Sotuvda qoldiqdan ko'p sotilganda POS yetmagan miqdorni sotuvning "borrowedItems" ro'yxatiga yozadi.
// Qo'shniga qarz faqat shu bo'lim ichida hisoblanadi: moliya, kassa va boshqa bo'limlarga ulanmaydi.
import { useEffect, useState } from "react";
import { ArrowLeftRight, CheckCircle, Clock, HandCoins, Search } from "lucide-react";
import Modal, { Field } from "../components/Modal";
import DateRangeFilter, { matchesDateRange } from "../components/DateRangeFilter";
import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { ADDITIONAL_SALES_KEY, SALES_KEY, getSales, saveSales } from "../supabase/bolimlar/sotuvlar";
import { useDataVersion } from "../supabase/db";
import "./Sales.css";
import "./Returns.css";
import "./Transfers.css";

const money = (value) => formatCurrency(value);
const num = (value) => Math.max(0, Number(value) || 0);
const SALE_KEYS = [SALES_KEY, ADDITIONAL_SALES_KEY];
const dateText = (value) => Number.isNaN(new Date(value).getTime()) ? "—" : new Date(value).toLocaleDateString("uz-UZ");
const dateTimeText = (value) => Number.isNaN(new Date(value).getTime()) ? "—" : new Date(value).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

const totalOf = (item) => num(item.quantity) * num(item.unitCost);
const paidOf = (item) => (Array.isArray(item.payments) ? item.payments : []).reduce((sum, payment) => sum + num(payment.amount), 0);
const statusOf = (item) => {
  const total = totalOf(item), paid = paidOf(item);
  if (item.status === "closed" || (total > 0 && paid >= total)) return "paid";
  return paid > 0 ? "partial" : "open";
};
const STATUS = {
  open: { label: "To'lanmagan", color: "var(--danger)", bg: "var(--danger-light)", icon: Clock },
  partial: { label: "Qisman to'langan", color: "var(--warning)", bg: "var(--warning-light, #fff6e5)", icon: Clock },
  paid: { label: "Yopilgan", color: "var(--success)", bg: "var(--success-light)", icon: CheckCircle },
};

function readRows() {
  return SALE_KEYS.flatMap((salesKey) => {
    const sales = getSales(salesKey);
    return (Array.isArray(sales) ? sales : []).flatMap((sale) => (Array.isArray(sale.borrowedItems) ? sale.borrowedItems : []).map((item) => ({
      ...item,
      salesKey,
      saleId: sale.id,
      saleNumber: sale.receiptNumber || sale.id,
      customer: sale.customerName || sale.customer || "",
      saleDate: sale.date,
    })));
  }).sort((a, b) => new Date(b.date || b.saleDate || 0) - new Date(a.date || a.saleDate || 0));
}

export default function Transfers() {
  useUILanguage();
  const { success } = useToast();
  const dataVersion = useDataVersion();
  const [rows, setRows] = useState(readRows);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [payInput, setPayInput] = useState("");
  const [payConfirm, setPayConfirm] = useState(false);
  const [costInput, setCostInput] = useState("");
  const [neighborInput, setNeighborInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  useEffect(() => {
    const refresh = () => setRows(readRows());
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [dataVersion]);

  const selected = rows.find((row) => row.id === selectedId) || null;
  useEffect(() => {
    if (!selected) return;
    setCostInput(String(num(selected.unitCost)));
    setNeighborInput(selected.neighbor || "");
    setNoteInput(selected.note || "");
    setPayInput("");
    setPayConfirm(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateItem = (row, patch) => {
    const sales = getSales(row.salesKey);
    const next = (Array.isArray(sales) ? sales : []).map((sale) => String(sale.id) !== String(row.saleId) ? sale : {
      ...sale,
      borrowedItems: (sale.borrowedItems || []).map((item) => {
        if (item.id !== row.id) return item;
        const updated = { ...item, ...patch };
        const paid = paidOf(updated), total = totalOf(updated);
        return { ...updated, total, paidAmount: paid, status: total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "open" };
      }),
    });
    saveSales(next, row.salesKey);
    setRows(readRows());
  };

  const query = search.trim().toLocaleLowerCase("uz-UZ");
  const filtered = rows.filter((row) => {
    if (statusFilter !== "all" && statusOf(row) !== statusFilter) return false;
    if (!matchesDateRange(row.date || row.saleDate, dateFrom, dateTo)) return false;
    return !query || [row.productName, row.sku, row.brand, row.category, row.customer, row.saleNumber, row.neighbor].some((value) => String(value || "").toLocaleLowerCase("uz-UZ").includes(query));
  });

  const now = new Date();
  const thisMonth = rows.filter((row) => { const date = new Date(row.date || row.saleDate); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
  const openRows = rows.filter((row) => statusOf(row) !== "paid");
  const totalDebt = rows.reduce((sum, row) => sum + Math.max(0, totalOf(row) - paidOf(row)), 0);

  const remaining = selected ? Math.max(0, totalOf(selected) - paidOf(selected)) : 0;
  const payValue = Math.min(remaining, toBaseMoney(payInput || 0) || 0);

  const savePayment = () => {
    if (!selected || payValue <= 0) return;
    const payment = { id: `PERPAY-${Date.now()}`, amount: payValue, date: new Date().toISOString() };
    updateItem(selected, { payments: [...(selected.payments || []), payment] });
    setPayInput(""); setPayConfirm(false);
    success("To'lov saqlandi", `${money(payValue)} · ${tx("Qolgan qarz")}: ${money(Math.max(0, remaining - payValue))}`);
  };
  const saveDetails = () => {
    if (!selected) return;
    updateItem(selected, { unitCost: num(toBaseMoney(costInput || 0)), neighbor: neighborInput.trim(), note: noteInput.trim() });
    success("Ma'lumot saqlandi", selected.productName);
  };

  return (
    <div className="space-y-4 fade-in returns-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-primary-color">{tx("Qarzdagi tovar")}</h1>
          <p className="text-sm mt-0.5 text-muted-color">{tx("Omborda yetmay, qo'shnidan olib sotilgan tovarlar va ularning qarzi")}</p>
        </div>
      </div>

      <div className="returns-stats grid grid-cols-4 gap-3">
        {[
          { label: "Shu oydagi yozuvlar", value: thisMonth.length.toLocaleString("uz-UZ"), color: "var(--brand)" },
          { label: "Jami yozuvlar", value: rows.length.toLocaleString("uz-UZ"), color: "var(--success)" },
          { label: "Yopilmagan", value: openRows.length.toLocaleString("uz-UZ"), color: "var(--warning)" },
          { label: "Qo'shniga umumiy qarz", value: money(totalDebt), color: "var(--danger)" },
        ].map((card) => (
          <div key={card.label} className="returns-stat-card card p-4">
            <div className="returns-stat-value text-xl font-display font-bold mb-1" style={{ color: card.color }}>{card.value}</div>
            <div className="returns-stat-label text-xs text-faint-color">{tx(card.label)}</div>
          </div>
        ))}
      </div>

      <div className="returns-table-card card-flat rounded-2xl">
        <div className="returns-filter-toolbar px-4 py-3 border-b-subtle">
          <div className="search-box-wrapper flex items-center gap-2 rounded-xl px-3 py-2.5 flex-1">
            <Search size={14} className="text-faint-color" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={tx("Qidirish")} placeholder={tx("Mahsulot, mijoz, chek yoki qo'shni...")} className="bg-transparent outline-none text-sm flex-1 text-primary-color" />
          </div>
          <select className="input-base" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={tx("Holat")}>
            <option value="all">{tx("Barcha holatlar")}</option>
            {Object.entries(STATUS).map(([id, status]) => <option key={id} value={id}>{tx(status.label)}</option>)}
          </select>
          <div className="returns-date-filter"><DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} /></div>
        </div>

        <div className="returns-table-scroll" role="region" aria-label={tx("Qarzdagi tovar")} tabIndex="0">
          <table className="returns-table transfers-table">
            <thead>
              <tr className="table-header-row">
                {["Sana", "Sotuv", "Mijoz", "Mahsulot", "Miqdor", "Tan narxi", "Qarz summasi", "Qolgan qarz", "Holat"].map((heading) => (
                  <th key={heading} className="text-left px-3 py-3 text-xs font-semibold text-faint-color">{tx(heading)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-color">{tx("Qarzdagi tovar yozuvlari topilmadi")}</td></tr>}
              {filtered.map((row) => {
                const status = STATUS[statusOf(row)], Icon = status.icon;
                return (
                  <tr key={row.id} className="border-t table-row-hover" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setSelectedId(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(row.id); } }}>
                    <td className="px-3 py-2.5 text-xs text-faint-color">{dateText(row.date || row.saleDate)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-color">{row.saleNumber}</td>
                    <td className="px-3 py-2.5 text-sm font-medium text-primary-color">{row.customer || "—"}</td>
                    <td className="px-3 py-2.5 text-sm text-secondary-color">{row.productName}{row.sku ? <small className="block text-faint-color">ID: {row.sku}</small> : null}</td>
                    <td className="px-3 py-2.5 text-sm text-secondary-color">{num(row.quantity).toLocaleString("uz-UZ")} {tx(row.unit || "dona")}</td>
                    <td className="px-3 py-2.5 text-sm text-secondary-color">{money(row.unitCost)}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-primary-color">{money(totalOf(row))}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-danger-color">{money(Math.max(0, totalOf(row) - paidOf(row)))}</td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold w-fit" style={{ background: status.bg, color: status.color }}><Icon size={10} />{tx(status.label)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal contentOnly open={Boolean(selected) && !payConfirm} onClose={() => setSelectedId(null)} title="Qarzdagi tovar" subtitle={selected ? `${selected.productName} · ${dateTimeText(selected.date || selected.saleDate)}` : ""} icon={ArrowLeftRight} width={620}>
        {selected && <div className="space-y-4">
          <dl className="text-sm">
            {[
              ["Mahsulot", `${selected.productName}${selected.brand ? ` · ${selected.brand}` : ""}`],
              ["ID raqami", selected.sku || "—"],
              ["Sotuv (chek)", String(selected.saleNumber)],
              ["Mijoz", selected.customer || "—"],
              ["Sotilgan jami miqdor", `${num(selected.soldQuantity || selected.quantity).toLocaleString("uz-UZ")} ${tx(selected.unit || "dona")}`],
              ["Qo'shnidan olingan miqdor", `${num(selected.quantity).toLocaleString("uz-UZ")} ${tx(selected.unit || "dona")}`],
              ["Mijozga sotilgan narx", money(selected.salePrice)],
              ["Qarz summasi", money(totalOf(selected))],
              ["To'langan", money(paidOf(selected))],
              ["Qolgan qarz", money(remaining)],
            ].map(([name, value]) => <div key={name} className="flex justify-between gap-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}><dt style={{ color: "var(--text-muted)" }}>{tx(name)}</dt><dd style={{ margin: 0, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", color: name === "Qolgan qarz" && remaining > 0 ? "var(--danger)" : undefined }}>{value}</dd></div>)}
          </dl>

          <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
            <h3 className="font-semibold text-sm">{tx("Qo'shni va narx")}</h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <Field label={tx("Qo'shni (kimdan olindi)")}><input className="input-base" value={neighborInput} onChange={(event) => setNeighborInput(event.target.value)} placeholder={tx("Masalan: Yonimizdagi do'kon")} /></Field>
              <Field label={tx("Bir dona narxi (tan narxi)")}><div className="relative"><input className="input-base pr-14" inputMode="numeric" value={costInput === "" ? "" : moneyInputValue(costInput, true)} onChange={(event) => { const raw = event.target.value.replace(/\D/g, ""); setCostInput(raw ? String(toBaseMoney(raw)) : ""); }} placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-muted)" }}>{tx("so'm")}</span></div></Field>
            </div>
            <Field label={tx("Izoh")}><input className="input-base" value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder={tx("Ixtiyoriy")} /></Field>
            <div className="flex justify-end"><button type="button" className="btn-ghost" onClick={saveDetails}>{tx("Saqlash")}</button></div>
          </section>

          {remaining > 0 && <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--danger-light)", border: "1px solid var(--danger-border)" }}>
            <h3 className="font-semibold text-sm" style={{ color: "var(--danger)" }}>{tx("Qo'shniga to'lash")}</h3>
            <div className="flex flex-wrap gap-2">
              <div className="relative" style={{ flex: "1 1 200px" }}><input className="input-base pr-14" inputMode="numeric" value={payInput === "" ? "" : moneyInputValue(payInput, true)} onChange={(event) => { const raw = event.target.value.replace(/\D/g, ""); setPayInput(raw ? String(Math.min(remaining, toBaseMoney(raw))) : ""); }} placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-muted)" }}>{tx("so'm")}</span></div>
              <button type="button" className="btn-ghost" onClick={() => setPayInput(String(remaining))}>{tx("Hammasi")}</button>
              <button type="button" className="btn-primary" disabled={payValue <= 0} onClick={() => setPayConfirm(true)}><HandCoins size={15} />{tx("To'lov qilish")}</button>
            </div>
          </section>}

          {(selected.payments || []).length > 0 && <section>
            <h3 className="font-semibold text-sm mb-2">{tx("To'lovlar tarixi")}</h3>
            <div className="space-y-1">{selected.payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><span>{dateTimeText(payment.date)}</span><b>{money(payment.amount)}</b></div>)}</div>
          </section>}
        </div>}
      </Modal>

      <Modal contentOnly open={Boolean(selected) && payConfirm} onClose={() => setPayConfirm(false)} title="To'lov qilinsinmi?" subtitle={selected?.productName || ""} icon={HandCoins} width={420}>
        {selected && <div className="space-y-4">
          <div className="space-y-2 text-sm">{[["To'lanadigan summa", money(payValue)], ["Qolgan qarz", money(remaining)], ["To'lovdan keyin qoladigan qarz", money(Math.max(0, remaining - payValue))]].map(([name, value]) => <div key={name} className="flex justify-between gap-3"><span style={{ color: "var(--text-muted)" }}>{tx(name)}</span><strong>{value}</strong></div>)}</div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPayConfirm(false)}>{tx("Yo'q, orqaga")}</button><button type="button" className="btn-primary" onClick={savePayment}>{tx("Ha, to'lov qilinsin")}</button></div>
        </div>}
      </Modal>
    </div>
  );
}
