import * as XLSX from "xlsx";
import { createReportPdf } from "../locales/reportPdf";
import { formatCurrency } from "./currency";
import { getTenantCompanyName } from "./tenantBrand";

const escapeHtml = (value) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const itemsForDocument = (sale) => sale.pendingItems || sale.items || [];
const quantityOf = (item) => Number(item.qty ?? item.quantity ?? 0);
const priceOf = (item) => Number(item.price || 0);
const totalOf = (item) => Number(item.total ?? priceOf(item) * quantityOf(item));
const dateText = (value) => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "—";
const safeFileName = (value) => String(value || "sotuv").replace(/[^a-z0-9_-]/gi, "-");
const totalsFor = (sale) => ({
  waitingAmount: itemsForDocument(sale).reduce((sum, item) => sum + totalOf(item), 0),
  amount: Number(sale.amount ?? sale.total ?? 0),
  paid: Number(sale.paidAmount ?? sale.initialPaidAmount ?? Math.max(0, Number(sale.amount || 0) - Number(sale.debtBalance || 0))),
  debt: Number(sale.debtBalance || 0),
});

export function printPendingPickupReceipt(sale) {
  const popup = window.open("", "_blank", "width=900,height=800");
  if (!popup) return false;
  popup.onload = () => { popup.focus(); popup.print(); };
  const company = getTenantCompanyName();
  const items = itemsForDocument(sale);
  const totals = totalsFor(sale);
  const rows = items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name || "Mahsulot")}</strong><small>${escapeHtml(item.sku || item.code || "")}</small></td><td>${quantityOf(item).toLocaleString("uz-UZ")} dona</td><td>${escapeHtml(dateText(item.deliveryDate))}</td><td>${escapeHtml(item.deliveryAddress || sale.deliveryAddress || "—")}</td><td>${escapeHtml(formatCurrency(priceOf(item)))}</td><td>${escapeHtml(formatCurrency(totalOf(item)))}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(company)} · Kutishdagi tovar ${escapeHtml(sale.displayId || sale.id)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#eef2f8;color:#172033;font:13px/1.5 Arial,sans-serif}.toolbar{display:flex;justify-content:flex-end;gap:10px;max-width:900px;margin:26px auto 12px}.toolbar button{min-height:40px;padding:0 16px;border:0;border-radius:9px;background:#285ee8;color:#fff;font-weight:700;cursor:pointer}.sheet{max-width:900px;margin:0 auto 28px;padding:38px;background:#fff;border:1px solid #e3e9f2;border-radius:16px;box-shadow:0 14px 42px #15233b18}.head{display:flex;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:2px solid #1e293b}.eyebrow,small{color:#69768d;font-size:10px}.eyebrow{font-weight:700;letter-spacing:.12em}h1{margin:5px 0;font-size:24px}.docno{text-align:right}.docno strong{display:block;font-size:15px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px;margin:18px 0}.meta div{padding:9px 0;border-bottom:1px solid #e8edf3}.meta span{display:block;color:#69768d;font-size:10px}.meta b{display:block;margin-top:2px;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin-top:18px}th{padding:9px 6px;background:#f2f5fa;color:#56647b;text-align:left;font-size:9px}td{padding:10px 6px;border-bottom:1px solid #e7ecf3;font-size:10px;vertical-align:top}td:nth-child(n+3){white-space:nowrap}td small{display:block}.totals{width:min(360px,100%);margin:18px 0 0 auto}.totals div{display:flex;justify-content:space-between;gap:12px;padding:5px 0}.totals span{color:#69768d}.totals .grand{margin-top:5px;padding-top:10px;border-top:2px solid #1e293b;font-size:15px;font-weight:800}.foot{margin-top:22px;padding-top:12px;border-top:1px solid #e8edf3;color:#69768d;font-size:10px}@media(max-width:650px){.sheet{margin:8px;padding:18px}.meta{grid-template-columns:1fr}table{font-size:9px}th,td{padding:6px 4px}.toolbar{margin:8px}}@media print{body{background:#fff}.toolbar{display:none}.sheet{max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none}tr{break-inside:avoid}thead{display:table-header-group}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Chekni chop etish</button><button onclick="window.close()">Yopish</button></div><main class="sheet"><header class="head"><div><div class="eyebrow">${escapeHtml(company)} · MIJOZGA TOPSHIRISH</div><h1>Kutishdagi tovarlar cheki</h1><small>Mijoz oldindan xarid qilgan va keyin olib ketadigan mahsulotlar</small></div><div class="docno"><span class="eyebrow">SOTUV RAQAMI</span><strong>${escapeHtml(sale.displayId || sale.receiptNumber || sale.id)}</strong><small>${escapeHtml(dateText(sale.createdAt || sale.date))}</small></div></header><section class="meta"><div><span>Mijoz</span><b>${escapeHtml(sale.customer || sale.customerName)}</b></div><div><span>Telefon</span><b>${escapeHtml(sale.customerPhone || "—")}</b></div><div><span>To‘lov usuli</span><b>${escapeHtml(sale.payment || sale.paymentMethod || "—")}</b></div><div><span>Sotgan xodim</span><b>${escapeHtml(sale.employeeName || "—")}</b></div><div><span>Buyurtma sanasi</span><b>${escapeHtml(dateText(sale.createdAt || sale.date))}</b></div><div><span>Yetkazish manzili</span><b>${escapeHtml(sale.deliveryAddress || "—")}</b></div></section><table><thead><tr><th>№</th><th>Mahsulot</th><th>Miqdor</th><th>Olish sanasi</th><th>Manzil</th><th>Bir dona narxi</th><th>Summa</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Kutishdagi mahsulotlar topilmadi</td></tr>'}</tbody></table><section class="totals"><div><span>Kutishdagi tovarlar summasi</span><b>${escapeHtml(formatCurrency(totals.waitingAmount))}</b></div><div><span>Butun sotuv summasi</span><b>${escapeHtml(formatCurrency(totals.amount))}</b></div><div><span>Butun sotuvdan to‘langan</span><b>${escapeHtml(formatCurrency(totals.paid))}</b></div><div class="grand"><span>Butun sotuv qarzi</span><b>${escapeHtml(formatCurrency(totals.debt))}</b></div></section><footer class="foot">Bu hujjat mijozga keyin topshiriladigan mahsulotlar ro‘yxatini ko‘rsatadi. Hujjat yaratilgan vaqt: ${escapeHtml(dateText(new Date()))}</footer></main></body></html>`);
  popup.document.close();
  return true;
}

export function downloadPendingPickupPdf(sale) {
  const company = getTenantCompanyName();
  const items = itemsForDocument(sale);
  const totals = totalsFor(sale);
  const wrap = (text, limit = 82) => {
    const words = String(text ?? "—").split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      if (line && `${line} ${word}`.length > limit) { lines.push(line); line = word; }
      else line += `${line ? " " : ""}${word}`;
    });
    if (line) lines.push(line);
    return lines;
  };
  const lines = [
    { t: `${company}  /  MIJOZGA TOPSHIRISH`, s: 11, b: true },
    { t: "Kutishdagi tovarlar hujjati", s: 22, b: true },
    { t: `Sotuv raqami: ${sale.displayId || sale.receiptNumber || sale.id}`, s: 12, b: true },
    { t: `Buyurtma sanasi: ${dateText(sale.createdAt || sale.date)}`, s: 11 },
    { t: `Mijoz: ${sale.customer || sale.customerName || "—"}`, s: 12, b: true },
    { t: `Telefon: ${sale.customerPhone || "—"}  |  To‘lov: ${sale.payment || sale.paymentMethod || "—"}`, s: 11 },
    { t: `Umumiy manzil: ${sale.deliveryAddress || "—"}`, s: 11 },
    { t: "", s: 10 },
    { t: "KUTILAYOTGAN MAHSULOTLAR", s: 13, b: true },
  ];
  items.forEach((item, index) => {
    wrap(`${index + 1}. ${item.name || "Mahsulot"}`).forEach((t) => lines.push({ t, s: 12, b: true }));
    lines.push({ t: `Miqdor: ${quantityOf(item).toLocaleString("uz-UZ")} dona  |  Olish sanasi: ${dateText(item.deliveryDate)}`, s: 10 });
    wrap(`Manzil: ${item.deliveryAddress || sale.deliveryAddress || "—"}`).forEach((t) => lines.push({ t, s: 10 }));
    lines.push({ t: `Bir dona narxi: ${formatCurrency(priceOf(item))}  |  Summa: ${formatCurrency(totalOf(item))}`, s: 10 }, { t: "", s: 9 });
  });
  lines.push(
    { t: `Kutishdagi tovarlar summasi: ${formatCurrency(totals.waitingAmount)}`, s: 12, b: true },
    { t: `Sotuv summasi: ${formatCurrency(totals.amount)}`, s: 12, b: true },
    { t: `Butun sotuvdan to‘langan: ${formatCurrency(totals.paid)}`, s: 11 },
    { t: `Butun sotuv qarzi: ${formatCurrency(totals.debt)}`, s: 12, b: true },
    { t: `Sotgan xodim: ${sale.employeeName || "—"}`, s: 10 },
    { t: `${company} tizimida yaratilgan hujjat · ${dateText(new Date())}`, s: 9 },
  );
  const url = URL.createObjectURL(createReportPdf(lines));
  const link = document.createElement("a");
  link.href = url;
  link.download = `Kutishdagi-tovar-${safeFileName(sale.displayId || sale.id)}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPendingPickupExcel(sale) {
  const items = itemsForDocument(sale);
  const totals = totalsFor(sale);
  const rows = [
    [getTenantCompanyName()],
    ["KUTISHDA OLIB KETILADIGAN MAHSULOTLAR", sale.displayId || sale.id],
    ["Mijoz", sale.customer || sale.customerName || "—"], ["Telefon", sale.customerPhone || "—"],
    ["Buyurtma sanasi", dateText(sale.createdAt || sale.date)], ["To‘lov usuli", sale.payment || sale.paymentMethod || "—"],
    ["Xodim", sale.employeeName || "—"], ["Umumiy manzil", sale.deliveryAddress || "—"], [],
    ["№", "Mahsulot", "Miqdor", "Olish sanasi", "Manzil", "Bir dona narxi (so‘m)", "Summa (so‘m)"],
    ...items.map((item, index) => [index + 1, item.name || "Mahsulot", quantityOf(item), item.deliveryDate || "—", item.deliveryAddress || sale.deliveryAddress || "—", priceOf(item), totalOf(item)]),
    ["", "Jami kutishdagi mahsulotlar", items.reduce((sum, item) => sum + quantityOf(item), 0), "", "", "", items.reduce((sum, item) => sum + totalOf(item), 0)],
    [], ["Kutishdagi tovarlar summasi (so‘m)", totals.waitingAmount], ["Butun sotuv summasi (so‘m)", totals.amount], ["Butun sotuvdan to‘langan (so‘m)", totals.paid], ["Butun sotuv qarzi (so‘m)", totals.debt],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 7 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 38 }, { wch: 22 }, { wch: 22 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Kutishdagi tovarlar");
  XLSX.writeFile(book, `Kutishdagi-tovar-${safeFileName(sale.displayId || sale.id)}.xlsx`);
}
