const n = value => Math.max(0, Number(value) || 0);
export const returnOffset = (record, orderId) => orderId != null && record.debtAllocations ? n(record.debtAllocations[String(orderId)]) : orderId != null && String(record.orderId) !== String(orderId) ? 0 : n(record.debtOffset ?? record.amount);
export const returnReceivable = record => record.version === 2 ? n(record.refundDue) - Math.min(n(record.refundDue), n(record.refundedAmount)) : 0;
export function orderReturnBalance(order, returns) {
 const remaining = order.status === 'paid' ? 0 : n(order.remaining ?? (order.status === 'debt' ? order.amount : 0));
 return Math.max(0, remaining - returns.reduce((s,r) => s + returnOffset(r, order.id), 0));
}
export function returnLimits(line, product, returns, orderId, reserved = {}) {
 const previous = returns.filter(r => String(r.orderId) === String(orderId) && String(r.productId) === String(product.id));
 const previouslyDefective = n(line.defectiveQuantity ?? line.defects?.reduce((s,d) => s+n(d.quantity),0));
 const previouslyGood = Math.max(0,n(line.quantity)-previouslyDefective);
 // Legacy return records did not distinguish condition; allocate good stock first.
 const old = previous.filter(r => r.version !== 2).reduce((s,r) => s+n(r.items),0);
 const goodReturned = previous.filter(r => r.version === 2).reduce((s,r) => s+n(r.goodQuantity),0) + Math.min(previouslyGood,old);
 const badReturned = previous.filter(r => r.version === 2).reduce((s,r) => s+n(r.defectiveQuantity),0) + Math.max(0,old-previouslyGood);
 const currentTotal = n(product.stock), currentDefective = Math.min(currentTotal,n(product.defectiveStock ?? product.defects?.reduce((s,d) => s+n(d.quantity),0))), currentGood = Math.max(0,currentTotal-currentDefective);
 const goodReserved = n(reserved.good), defectiveReserved = n(reserved.defective);
 const defectIds = new Set((product.defects || []).filter(d => n(d.quantity)>0).map(d => String(d.id)));
 // Limit each return by live stock minus active reservations; previous returns are history, not a second deduction.
 return { goodReceived: currentGood, goodReturned, goodReserved, goodMax: Math.max(0,currentGood-goodReserved), defectiveReceived: currentDefective, defectiveReturned: badReturned, defectiveReserved, badMax: Math.max(0,currentDefective-defectiveReserved), goodCost: n(line.cost ?? product.cost), badCost: n(line.defectUnitPrice ?? line.defects?.[0]?.unitPrice ?? line.cost ?? product.cost), defectIds: [...defectIds] };
}
export function summarizeOrderReturns(orderId, lines, returns) {
 const byUnit = { good: new Map(), defective: new Map() };
 const add = (kind, unit, quantity) => {
   if (quantity > 0) byUnit[kind].set(unit, (byUnit[kind].get(unit) || 0) + quantity);
 };
 const lineByProduct = new Map();
 lines.forEach(line => {
   const productId = line.id ?? line.product?.id;
   if (productId == null) return;
   const key = String(productId);
   const current = lineByProduct.get(key);
   if (current) {
     current.quantity += n(line.quantity);
     current.defectiveQuantity += n(line.defectiveQuantity ?? line.defects?.reduce((sum, defect) => sum + n(defect.quantity), 0));
   } else {
     lineByProduct.set(key, { ...line, id: productId, product: line.product || { id: productId }, quantity: n(line.quantity), defectiveQuantity: n(line.defectiveQuantity ?? line.defects?.reduce((sum, defect) => sum + n(defect.quantity), 0)) });
   }
 });
 const orderReturns = returns.filter(record => String(record.orderId) === String(orderId));
 lineByProduct.forEach((line, productId) => {
   const limits = returnLimits(line, { ...line.product, id: productId }, orderReturns, orderId);
   const unit = line.measurementUnit || line.product?.measurementUnit || (line.measurementType === 'weight' || line.product?.measurementType === 'weight' ? 'kg' : 'dona');
   add('good', unit, limits.goodReturned);
   add('defective', unit, limits.defectiveReturned);
 });
 // Count newer return records even if their product line is no longer present in the receipt details.
 orderReturns.filter(record => record.version === 2 && !lineByProduct.has(String(record.productId))).forEach(record => {
   const unit = record.measurementUnit || 'dona';
   add('good', unit, n(record.goodQuantity));
   add('defective', unit, n(record.defectiveQuantity));
 });
 return { good: Object.fromEntries(byUnit.good), defective: Object.fromEntries(byUnit.defective) };
}
export function calculateReturn(draft) {
 const goodQuantity = Number(draft.goodQuantity || 0), defectiveQuantity = Number(draft.defectiveQuantity || 0), refundedAmount = Number(draft.refundedAmount || 0);
 const amount = Math.round((goodQuantity*draft.goodCost + defectiveQuantity*draft.badCost)*100)/100;
 // Ta’minotchi qaytargan naqd pul ham umumiy qaytarish summasining bir qismi.
 // Avval shu pulni hisobga olib, qolgan summanigina qarzdan ayiramiz.
 const debtOffset = Math.min(n(draft.orderDebt),Math.max(0,amount-refundedAmount)), refundDue = Math.max(0,amount-debtOffset);
 const fractional = ['kg','g','l','ml','m','metr','m2','m3'].includes(draft.unit);
 const validQuantity = value => Number.isFinite(value) && value >= 0 && (fractional || Number.isInteger(value));
 const valid = Boolean(draft.reason?.trim()) && validQuantity(goodQuantity) && validQuantity(defectiveQuantity) && goodQuantity+defectiveQuantity>0 && goodQuantity<=draft.goodMax && defectiveQuantity<=draft.badMax && Number.isFinite(refundedAmount) && refundedAmount>=0 && refundedAmount<=amount && Number.isFinite(amount);
 return {goodQuantity,defectiveQuantity,amount,debtOffset,refundDue,refundedAmount,supplierOwes: Math.max(0,refundDue-refundedAmount),valid};
}
export function reduceReturnStock(product, record, defectIds = []) {
 let remaining = record.defectiveQuantity;
 const tracked = new Set(defectIds);
 const defects = (product.defects || []).map(defect => {
   if (tracked.size && !tracked.has(String(defect.id))) return defect;
   const removed = Math.min(n(defect.quantity),remaining); remaining -= removed;
   const quantity = n(defect.quantity)-removed;
   return {...defect,quantity,total:quantity*n(defect.unitPrice ?? defect.price)};
 });
 const stock = Math.max(0,n(product.stock)-record.goodQuantity-record.defectiveQuantity), defectiveStock = Math.max(0,n(product.defectiveStock)-record.defectiveQuantity);
 const sellable = Math.max(0,stock-defectiveStock);
 return {...product,stock,defectiveStock,defects,status:sellable===0?'out':sellable<10?'low':'active'};
}

export function supplierOutstanding(supplier, orders, returns) {
 const orderTotal=orders.reduce((sum,order)=>sum+orderReturnBalance(order,returns),0);
 const legacy=Math.max(n(supplier.legacyDebt),n(supplier.debt)-orderTotal);
 return {total:orderTotal+legacy,legacy};
}
export function allocateReturnDebt(value, supplier, orders, returns, preferredId) {
 let remaining=n(value);const debtAllocations={};
 const sorted=[...orders].sort((a,b)=>Number(String(b.id)===String(preferredId))-Number(String(a.id)===String(preferredId)));
 sorted.forEach(order=>{const allocated=Math.min(remaining,orderReturnBalance(order,returns));if(allocated>0)debtAllocations[String(order.id)]=allocated;remaining-=allocated;});
 return {debtAllocations,legacyOffset:Math.min(remaining,supplierOutstanding(supplier,orders,returns).legacy)};
}
