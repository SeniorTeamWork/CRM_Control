import { useEffect, useRef, useState } from 'react';
import Modal, { Field } from './Modal';
import { Printer, RotateCcw, Search } from 'lucide-react';
import { formatCurrency, moneyInputValue, toBaseMoney } from '../data/currency';
import { calculateReturn, returnReceivable } from '../data/supplierReturns';
import { useLanguage } from '../context/LanguageContext';
import { translateText as tx } from '../locales/translateText';
import './SupplierReturns.css';
const money = formatCurrency;
export const formatQuantityInput = (value) => {
 const raw = String(value ?? "").replace(/,/g, "").replace(/[^\d.]/g, "");
 const dot = raw.indexOf(".");
 const integer = (dot < 0 ? raw : raw.slice(0, dot)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
 if (dot < 0) return integer;
 return `${integer}.${raw.slice(dot + 1).replace(/\./g, "")}`;
};
export const capQuantityInput = (value, maximum, unit) => {
 const raw = String(value ?? "").replace(/,/g, "").replace(/[^\d.]/g, "");
 if (!raw) return "";
 const fractional = !['dona','ta'].includes(unit);
 const normalized = fractional ? raw.replace(/\.(?=.*\.)/g, "") : raw.split('.')[0];
 const parsed = Number(normalized);
 return Number.isFinite(parsed) && parsed > Number(maximum) ? String(maximum) : normalized;
};
export const returnDate = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '—';
const returnDayKey = value => {
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return '';
 const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part = type => parts.find(item => item.type === type)?.value || '';
 return `${part('year')}-${part('month')}-${part('day')}`;
};
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function printSupplierReturn(record) {
 const popup = window.open('', '_blank', 'width=800,height=800');
 if (!popup) return false;
 const fields = [['Chek',record.id],['Ta’minotchi',record.supplierName],['Mahsulot',record.productName],['Buyurtma',record.orderId],['Qabul sanasi',returnDate(record.receivedAt)],['Qaytarilgan sana va vaqt',returnDate(record.returnedAt)],['Yaroqli miqdor',`${record.goodQuantity} ${record.measurementUnit}`],['Yaroqli tan narxi',money(record.goodUnitCost)],['Brak miqdori',`${record.defectiveQuantity} ${record.measurementUnit}`],['Brak tan narxi',money(record.defectUnitCost)],['Umumiy summa',money(record.amount)],['Bizning qarzimizdan ayirildi',money(record.debtOffset)],['Ta’minotchi qaytarishi kerak',money(record.refundDue)],['Qaytgan pul',money(record.refundedAmount)],['Ta’minotchining bizga qarzi',money(returnReceivable(record))],['Sabab',record.reason]];
 popup.document.write('<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>Qaytarish cheki</title><style>body{font:15px Arial;padding:32px;color:#172033}h1{font-size:24px}dl div{display:flex;justify-content:space-between;gap:25px;padding:10px 0;border-bottom:1px solid #ddd}dt{color:#526078}dd{margin:0;text-align:right;font-weight:bold}@media print{body{padding:0}}</style></head><body><h1>Tovarni qaytarish cheki</h1><dl>'+fields.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl></body></html>');
 popup.document.close(); popup.focus(); popup.print(); return true;
}
export function SupplierReturnPrompt({ record, close }) {
 const [seconds,setSeconds] = useState(3);
 const closeRef = useRef(close);
 const recordId = record?.id;
 useEffect(()=>{closeRef.current=close;},[close]);
 useEffect(()=>{
  if(recordId == null)return;
  let remaining=3;
  setSeconds(remaining);
  const interval=window.setInterval(()=>{
   remaining-=1;
   if(remaining<=0){window.clearInterval(interval);closeRef.current();return;}
   setSeconds(remaining);
  },1000);
  return()=>window.clearInterval(interval);
 },[recordId]);
 return <Modal contentOnly open={!!record} onClose={close} title="Chekni chiqarish" icon={RotateCcw} width={480}>
  <p className="text-sm supplier-return-prompt-message">{tx('Chek ta’minotchi tarixida saqlandi.')}</p>
  <div className="supplier-return-prompt-actions">
   <button className="btn-primary supplier-return-prompt-button" onClick={()=>{if(printSupplierReturn(record))close();}}>
    <Printer size={15}/><span>{tx('Chekni chiqarish')}</span><span className="supplier-return-prompt-countdown">{seconds}s</span>
   </button>
  </div>
 </Modal>;
}
function SupplierReturnReceiptModal({ record, onClose }) {
 if (!record) return null;
 const quantities = [
  [`${tx('Yaroqli')} (${record.goodQuantity ?? 0} ${record.measurementUnit || 'dona'})`, money((record.goodQuantity || 0) * (record.goodUnitCost || 0))],
  [`${tx('Brak')} (${record.defectiveQuantity ?? 0} ${record.measurementUnit || 'dona'})`, money((record.defectiveQuantity || 0) * (record.defectUnitCost || 0))],
 ];
 const details = [
  [tx('Chek raqami'), record.id],
  [tx('Sana'), returnDate(record.returnedAt)],
  [tx('Ta’minotchi'), record.supplierName || '—'],
  [tx('Qabul sanasi'), returnDate(record.receivedAt)],
 ];
 const balances = [
  [tx('Umumiy qaytarish summasi'), money(record.amount)],
  [tx('Bizning qarzimizdan ayirildi'), money(record.debtOffset)],
  [tx('Ta’minotchi qaytarishi kerak'), money(record.refundDue)],
  [tx('Ta’minotchidan qaytgan pul'), money(record.refundedAmount)],
  [tx('Ta’minotchining bizga qolgan qarzi'), money(returnReceivable(record))],
 ];
 return <Modal contentOnly open onClose={onClose} title="Chek" subtitle="Ta’minotchiga qaytarish cheki" icon={Printer} width={460}>
  <article className="supplier-return-receipt">
   <header className="supplier-return-receipt-brand"><strong>SamDunyo</strong><span>{tx('Tovar qaytarish cheki')}</span></header>
   <div className="supplier-return-receipt-details">{details.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <h4>{tx('Mahsulot')}</h4>
   <strong>{record.productName || '—'}</strong>
   <div className="supplier-return-receipt-items">{quantities.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <div className="supplier-return-receipt-balances">{balances.map(([label,value],index)=><div className={index===0?'is-total':''} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   {record.reason && <p className="supplier-return-receipt-reason"><span>{tx('Qaytarish sababi')}:</span> {record.reason}</p>}
   <p className="supplier-return-receipt-thanks">{tx('Hamkorligingiz uchun rahmat!')}</p>
  </article>
  <div className="supplier-return-receipt-actions"><button className="btn-ghost" onClick={onClose}>{tx('Yopish')}</button><button className="btn-primary" onClick={()=>{if(printSupplierReturn(record))onClose();}}><Printer size={15}/>{tx('Chekni chiqarish')}</button></div>
 </Modal>;
}
function SupplierReturnDetailsModal({ record, onClose, onReceivePayment }) {
 const [paymentInput,setPaymentInput]=useState('0');
 useEffect(()=>{setPaymentInput('0');},[record?.id]);
 if (!record) return null;
 const unit=record.measurementUnit||'dona';
 const modern=record.version===2;
 const goodQuantity=Number(record.goodQuantity)||0;
 const defectiveQuantity=Number(record.defectiveQuantity)||0;
 const details=[
  [tx('ID'),record.id||'—'],[tx('Ta’minotchi'),record.supplierName||'—'],
  [tx('Mahsulot'),record.productName||'—'],[tx('Kategoriya'),record.productCategory||record.categoryName||record.category||'—'],
  [tx('Buyurtma'),record.orderId||'—'],[tx('Qabul sanasi'),returnDate(record.receivedAt)],
  [tx('Qaytarilgan sana va vaqt'),returnDate(record.returnedAt)],
 ];
 const amounts=modern?[
  [tx('Umumiy qaytarish summasi'),money(record.amount)],
  [tx('Bizning qarzimizdan ayirildi'),money(record.debtOffset)],
  [tx('Ta’minotchi qaytarishi kerak'),money(record.refundDue)],
  [tx('Ta’minotchidan qaytgan pul'),money(record.refundedAmount)],
  [tx('Ta’minotchining bizga qolgan qarzi'),money(returnReceivable(record))],
 ]:[[tx('Qaytarish summasi'),money(record.amount)]];
 const status=!modern?'Eski yozuv':Number(record.refundDue||0)<=0?'Qarzdan ayrildi':returnReceivable(record)<=0?'To‘liq qaytardi':Number(record.refundedAmount||0)>0?'Qisman qaytardi':'Pul kutilmoqda';
 return <Modal contentOnly open onClose={onClose} title="Qaytarish tafsilotlari" subtitle={record.productName||record.supplierName||''} icon={RotateCcw} width={680}>
  <div className="supplier-return-details-modal">
   <div className="supplier-return-detail-grid">{details.map(([label,value])=><div className="supplier-return-detail-item" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   {modern?<div className="supplier-return-condition-grid">
    <article><h4>{tx('Yaroqli')}</h4><p>{tx('Qaytarilgan miqdor')}: <strong>{goodQuantity.toLocaleString('uz-UZ')} {tx(unit)}</strong></p><p>{tx('Qabuldagi tan narxi')}: <strong>{money(record.goodUnitCost)}</strong></p><p>{tx('Jami')}: <strong>{money(goodQuantity*Number(record.goodUnitCost||0))}</strong></p></article>
    <article className="is-defective"><h4>{tx('Brak')}</h4><p>{tx('Qaytarilgan miqdor')}: <strong>{defectiveQuantity.toLocaleString('uz-UZ')} {tx(unit)}</strong></p><p>{tx('Qabuldagi tan narxi')}: <strong>{money(record.defectUnitCost)}</strong></p><p>{tx('Jami')}: <strong>{money(defectiveQuantity*Number(record.defectUnitCost||0))}</strong></p></article>
   </div>:<div className="supplier-return-detail-item"><span>{tx('Qaytarilgan miqdor')}</span><strong>{Number(record.items||0).toLocaleString('uz-UZ')} {tx(unit)}</strong></div>}
   <div className="supplier-return-detail-amounts">{amounts.map(([label,value],index)=><div className={index===0?'is-total':''} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <div className="supplier-return-detail-item supplier-return-detail-status"><span>{tx('Holat')}</span><strong>{tx(status)}</strong></div>
   <div className="supplier-return-detail-reason"><span>{tx('Qaytarish sababi')}</span><p>{record.reason||'—'}</p></div>
   {modern&&onReceivePayment&&returnReceivable(record)>0&&<div className="supplier-return-debt-payment">
    <h4>{tx('Qarzni to‘lash')}</h4>
    <label htmlFor="supplier-return-debt-payment-amount">{tx('To‘lanadigan summa')}</label>
    <div className="supplier-return-debt-payment-input"><input id="supplier-return-debt-payment-amount" className="input-base" type="text" inputMode="numeric" value={paymentInput===''?'':moneyInputValue(paymentInput,true)} onChange={event=>setPaymentInput(event.target.value===''?'':String(Math.min(returnReceivable(record),toBaseMoney(event.target.value))))} placeholder="0"/><span>{tx("so'm")}</span></div>
    <div className="supplier-return-debt-payment-summary"><div><span>{tx('Jami qarz')}</span><strong>{money(returnReceivable(record))}</strong></div><div><span>{tx('To‘lovdan keyin qoladigan qarz')}</span><strong>{money(Math.max(0,returnReceivable(record)-toBaseMoney(paymentInput)))}</strong></div></div>
    <button type="button" className="btn-primary supplier-return-debt-payment-submit" disabled={toBaseMoney(paymentInput)<=0} onClick={()=>{const updated=onReceivePayment(record,toBaseMoney(paymentInput));if(updated)setPaymentInput('0');}}>{tx('To‘lovni qabul qilish')}</button>
   </div>}
   <div className="supplier-return-receipt-actions"><button className="btn-ghost" onClick={onClose}>{tx('Yopish')}</button>{modern&&<button className="btn-primary" onClick={()=>printSupplierReturn(record)}><Printer size={14}/>{tx('Chek')}</button>}</div>
  </div>
 </Modal>;
}
export function SupplierReturnForm({ draft, setDraft, confirming, setConfirming, close, confirm }) {
 useLanguage();
 if(!draft)return null;
 const totals=calculateReturn(draft);
 const update=(key,value)=>setDraft({...draft,[key]:value});
 const limitMessage = totals.goodQuantity > draft.goodMax
  ? `Yaroqli mahsulotdan ${formatQuantityInput(draft.goodMax)} ${tx(draft.unit)} qaytarish mumkin. Kiritilgan miqdorni kamaytiring.`
  : totals.defectiveQuantity > draft.badMax
   ? `Brak mahsulotdan ${formatQuantityInput(draft.badMax)} ${tx(draft.unit)} qaytarish mumkin. Kiritilgan miqdorni kamaytiring.`
   : totals.refundedAmount > totals.amount
    ? `Ta’minotchidan qaytgan pul ${money(totals.amount)} dan oshmasligi kerak.`
    : totals.goodQuantity + totals.defectiveQuantity <= 0
     ? 'Yaroqli yoki brak mahsulot miqdorini kiriting.'
     : '';
 return <Modal contentOnly open onClose={close} title={confirming?'Qaytarishni tasdiqlash':'Tovarni qaytarish'} subtitle={draft.product.name} icon={RotateCcw} width={620}><div className="supplier-return-form">
 <p className="text-xs">{tx('Qabul sanasi')}: {returnDate(draft.receivedAt)}</p>
 <div className="supplier-return-grid">{[['Yaroqli','goodQuantity',draft.goodMax,draft.goodCost,draft.goodReceived,draft.goodReserved],['Brak','defectiveQuantity',draft.badMax,draft.badCost,draft.defectiveReceived,draft.defectiveReserved]].map(([label,key,max,cost,available,reserved])=><div className="supplier-return-box" key={key}><b>{tx(label)}</b><p>{tx('Hozir omborda')}: {formatQuantityInput(available)} {tx(draft.unit)}</p><p>{tx('Band qilingan')}: {formatQuantityInput(reserved)} {tx(draft.unit)}</p><p>{tx('Qaytarish mumkin')}: {formatQuantityInput(max)} {tx(draft.unit)}</p><p>{tx('Qabuldagi tan narxi')}: {money(cost)}</p><Field label={tx('Qaytariladigan miqdor')}><input className="input-base" type="text" placeholder="0" inputMode={['dona','ta'].includes(draft.unit)?'numeric':'decimal'} disabled={confirming || Number(max)<=0} value={formatQuantityInput(draft[key])} onChange={e=>update(key,capQuantityInput(e.target.value,max,draft.unit))}/></Field><strong>{money(Number(draft[key]||0)*cost)}</strong></div>)}</div>
 <Field label={tx('Qaytarish sababi')}><textarea className="input-base" rows={2} disabled={confirming} value={draft.reason} onChange={e=>update('reason',e.target.value)}/></Field>
 <dl className="supplier-return-totals">{[['Umumiy summa',totals.amount],['Bizning qarzimizdan ayiriladi',totals.debtOffset],['Qaytarish summasi (jami)',totals.refundDue],['Ta’minotchi qaytarishi kerak',totals.supplierOwes]].map(([label,value])=><div key={label}><dt>{tx(label)}</dt><dd>{money(value)}</dd></div>)}</dl>
 <Field label={tx('Ta’minotchidan hozir qaytgan pul')}><div className="relative"><input placeholder="0" className="input-base pr-14" inputMode="decimal" disabled={confirming} value={moneyInputValue(draft.refundedAmount)} onChange={e=>update('refundedAmount',String(toBaseMoney(e.target.value)))}/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{color:'var(--text-muted)'}}>{tx("so'm")}</span></div></Field>
 {draft.error && <p role="alert" style={{color:'var(--danger)'}}>{tx(draft.error)}</p>}
 {!totals.valid && <p className="text-xs" role="status" style={{color:limitMessage?'var(--danger)':'var(--text-muted)'}}>{tx(limitMessage || 'Miqdor va sababni kiriting. Qaytgan pul qaytarilishi kerak bo‘lgan summadan oshmasin.')}</p>}
 <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={confirming?()=>setConfirming(false):close}>{tx(confirming?'Orqaga':'Bekor qilish')}</button><button className="btn-primary" disabled={!totals.valid} onClick={confirming?confirm:()=>setConfirming(true)}>{tx(confirming?'Tasdiqlash va qaytarish':'Davom etish')}</button></div>
 </div></Modal>;
}
export default function SupplierReturnsLedger({ records, showDashboard = false, onReceivePayment }) {
 useLanguage();
 const [selected,setSelected]=useState(null);
 const [receiptRecord,setReceiptRecord]=useState(null);
 const [query,setQuery]=useState('');
 const [productFilter,setProductFilter]=useState('');
 const [dateFrom,setDateFrom]=useState('');
 const [dateTo,setDateTo]=useState('');
 const nowKey=returnDayKey(new Date());
 const todayRecords=records.filter(record=>returnDayKey(record.returnedAt)===nowKey);
 const productOptions=[...new Set(records.map(record=>String(record.productName||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'uz-UZ'));
 const categoryOptions=[...new Set(records.map(record=>String(record.productCategory||record.categoryName||record.category||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'uz-UZ'));
 const normalizedQuery=query.trim().toLocaleLowerCase('uz-UZ');
 const filteredRecords=records.filter(record=>{
  const category=String(record.productCategory||record.categoryName||record.category||'');
  const searchText=[record.id,record.orderId,record.supplierName,record.productName,record.reason,category].join(' ').toLocaleLowerCase('uz-UZ');
  const day=returnDayKey(record.returnedAt);
  const filterMatches=!productFilter||(productFilter.startsWith('category:')?category===productFilter.slice(9):String(record.productName||'')===productFilter);
  return (!normalizedQuery||searchText.includes(normalizedQuery)) && filterMatches && (!dateFrom||(day&&day>=dateFrom)) && (!dateTo||(day&&day<=dateTo));
 });
 const stats=[
  {label:'Ta’minotchilarning bizga qarzi',value:money(records.reduce((sum,record)=>sum+returnReceivable(record),0)),color:'var(--danger)'},
  {label:'Jami qaytarilganlar',value:records.length,color:'var(--success)'},
  {label:'Bugungi qaytarilganlar',value:todayRecords.length,color:'var(--warning)'},
  {label:'Umumiy qaytarilgan summa',value:money(records.reduce((sum,record)=>sum+(Number(record.amount)||0),0)),color:'var(--danger)'},
 ];
 const clearFilters=()=>{setQuery('');setProductFilter('');setDateFrom('');setDateTo('');};
 return <div className="supplier-return-dashboard">
 {showDashboard&&<div className="supplier-return-stats">{stats.map(stat=><div className="card supplier-return-stat" key={stat.label}><strong style={{color:stat.color}}>{stat.value}</strong><span>{tx(stat.label)}</span></div>)}</div>}
 <section className="card supplier-return-ledger"><h3>{tx('Ta’minotchilarga qaytarilgan tovarlar')}</h3>
 {showDashboard&&<div className="supplier-return-filters">
  <label className="supplier-return-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={tx('Ta’minotchi, mahsulot, sabab yoki ID...')} aria-label={tx('Qaytarilgan tovarlarni qidirish')}/></label>
  <select className="input-base" value={productFilter} onChange={event=>setProductFilter(event.target.value)} aria-label={tx('Kategoriya yoki mahsulot')}><option value="">{tx('Kategoriya yoki mahsulot...')}</option>{categoryOptions.length>0&&<optgroup label={tx('Kategoriyalar')}>{categoryOptions.map(category=><option key={category} value={`category:${category}`}>{category}</option>)}</optgroup>}<optgroup label={tx('Mahsulotlar')}>{productOptions.map(product=><option key={product} value={product}>{product}</option>)}</optgroup></select>
  <label className="supplier-return-date"><span>{tx('Dan')}</span><input className="input-base" type="date" value={dateFrom} onChange={event=>setDateFrom(event.target.value)} aria-label={tx('Boshlanish sanasi')}/></label>
  <label className="supplier-return-date"><span>{tx('Gacha')}</span><input className="input-base" type="date" value={dateTo} onChange={event=>setDateTo(event.target.value)} aria-label={tx('Tugash sanasi')}/></label>
  <button className="btn-ghost supplier-return-clear" type="button" onClick={clearFilters} disabled={!query&&!productFilter&&!dateFrom&&!dateTo}>{tx('Tozalash')}</button>
 </div>}
 <div className="supplier-return-scroll"><table><thead><tr>{['Ta’minotchi / mahsulot','Sana va vaqt','Qaytarilgan miqdor','Sabab','Qaytarish summasi','Qaytgan pul','Bizga qarzi','Holat','Chek'].map(label=><th key={label}>{tx(label)}</th>)}</tr></thead><tbody>{filteredRecords.map(r=>{
  const receivable=returnReceivable(r);
  const status=r.version!==2?'Eski yozuv':Number(r.refundDue||0)<=0?'Qarzdan ayrildi':receivable<=0?'To‘liq qaytardi':Number(r.refundedAmount||0)>0?'Qisman qaytardi':'Pul kutilmoqda';
  return <tr key={r.id} className="supplier-return-clickable-row" tabIndex={0} aria-label={`${tx('Tafsilotlarni ko‘rish')}: ${r.supplierName||''} ${r.productName||''}`} onClick={()=>setSelected(r)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setSelected(r);}}}><td><div className="supplier-return-row-product"><strong>{r.supplierName||'—'}</strong><br/>{r.productName}<small>{String(r.id||'').slice(0,18)}</small></div></td><td>{returnDate(r.returnedAt)}</td><td>{r.version===2?<><div>{tx('Yaroqli')}: {Number(r.goodQuantity||0).toLocaleString('uz-UZ')} {tx(r.measurementUnit||'dona')}</div><div className="supplier-return-defective">{tx('Brak')}: {Number(r.defectiveQuantity||0).toLocaleString('uz-UZ')} {tx(r.measurementUnit||'dona')}</div></>:`${Number(r.items||0).toLocaleString('uz-UZ')} ${tx(r.measurementUnit||'dona')}`}</td><td className="supplier-return-reason-cell" title={r.reason||''}>{r.reason||'—'}</td><td>{money(r.amount)}</td><td>{r.version===2?money(r.refundedAmount):'—'}</td><td className="supplier-return-debt-amount">{r.version===2?money(receivable):'—'}</td><td><span className={`supplier-return-status ${status==='To‘liq qaytardi'||status==='Qarzdan ayrildi'?'is-complete':status==='Qisman qaytardi'?'is-partial':'is-pending'}`}>{tx(status)}</span></td><td>{r.version===2?<button className="btn-primary supplier-return-check-button" onClick={event=>{event.stopPropagation();setReceiptRecord(r);}} aria-haspopup="dialog" title={tx('Chekni chiqarish')}><Printer size={13}/>{tx('Chek')}</button>:<span>{tx('Eski yozuv')}</span>}</td></tr>;
 })}{!filteredRecords.length&&<tr><td colSpan={9} className="supplier-return-empty">{tx('Qaytarilgan tovarlar topilmadi.')}</td></tr>}</tbody></table></div>
 {showDashboard&&<div className="supplier-return-result-count">{filteredRecords.length} {tx('ta natija')}</div>}
 <SupplierReturnDetailsModal record={selected} onClose={()=>setSelected(null)} onReceivePayment={onReceivePayment?((record,value)=>{const updated=onReceivePayment(record,value);if(updated)setSelected(updated);return updated;}):undefined}/>
 <SupplierReturnReceiptModal record={receiptRecord} onClose={()=>setReceiptRecord(null)}/>
 </section></div>;
}
