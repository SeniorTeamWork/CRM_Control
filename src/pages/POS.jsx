import { nextDocumentNumber } from "../data/documentNumbers";
import SalesProductFilter from "../components/SalesProductFilter";
import { normalizeProductText, saleMatchesProduct } from "../data/salesProductFilter";
import "./Sales.css";
import { resolveReceivingCard } from "../data/directorCards";
import ReceivingCardSelect from "../components/ReceivingCardSelect";
import ReceiptPaymentDetails from "../components/ReceiptPaymentDetails";
import ProductQuickAddModal from "../components/ProductQuickAddModal";
import { useTenantCompanyName } from "../data/tenantBrand";
import Modal from "../components/Modal";
import {
  POS_DRAFT_KEY,
  readPosDraft,
  cartKeyFor,
  createAddressId,
  phoneDigits,
  getDefaultDebtDueDate,
} from "./posHelpers";
import { PaymentSuccessAnimation } from './PosPaymentPanel';
import { CartPanelContent } from './PosCartPanel';
import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage, useLanguage } from "../context/LanguageContext";
import { createPortal } from "react-dom";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./POS.css";
import "./POSTheme.css";
import {
  FiBookmark,
  FiSearch,
  FiShoppingCart,
  FiUser,
  FiAlertTriangle,
  FiPrinter,
  FiX,
} from "react-icons/fi";
import { useToast } from "../context/ToastContext";
import checkAnimationSound from "../assets/check animation sound.m4a";

import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { uniqueProductCount } from "../data/productCounts";
import { defectReservationKey, readOrders, removeOrder, reservedQuantitiesByCondition as readReservedQuantitiesByCondition } from "../data/ordersStore";
import { deleteSaleDraft } from "../data/savedSaleDrafts";
import { saveDebtPayment } from "../data/debtPayments";
import { getData, removeData, setData } from "../supabase/db";
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";
import { getSuppliers } from "../supabase/bolimlar/taminotchilar";
const formatUzPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "").slice(-9);
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(" ");
};
const todayForDateInput = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const isPartiallyWorkingDefect = (defect) => String(defect?.status || "").trim().toLocaleLowerCase("uz-UZ").startsWith("qisman ishlaydi");
const partialWorkingQuantity = (product) => (Array.isArray(product?.defects) ? product.defects : [])
  .filter(isPartiallyWorkingDefect)
  .reduce((sum, defect) => sum + Math.max(0, Number(defect.quantity) || 0), 0);
const actualDefectiveStock = (product) => Math.max(0, Number(product?.defectiveStock || 0) - partialWorkingQuantity(product));

const defectSaleRows = (product) => {
  const defects = Array.isArray(product?.defects) ? product.defects : [];
  const rows = defects.filter((defect) => !isPartiallyWorkingDefect(defect)).map((defect, index) => ({
    ...product,
    defectId: String(defect.id || `${product.id}-defect-${index}`),
    defectLotQuantity: Math.max(0, Number(defect.quantity) || 0),
    defectStatus: "Brak",
    defectReason: defect.reason || "",
    defectPrice: Number(defect.salePrice ?? defect.sellingPrice ?? product.defectSalePrice ?? product.defectPrice ?? defect.unitPrice ?? defect.price ?? product.price ?? product.cost ?? 0),
  })).filter((row) => row.defectLotQuantity > 0);
  const recordedQuantity = defects.reduce((sum, defect) => sum + Math.max(0, Number(defect.quantity) || 0), 0);
  const unrecordedQuantity = Math.max(0, Number(product?.defectiveStock || 0) - recordedQuantity);
  if (unrecordedQuantity > 0) rows.push({
    ...product,
    defectId: `${product.id}-defect-unrecorded`,
    defectLotQuantity: unrecordedQuantity,
    defectStatus: "Brak",
    defectReason: "",
    defectPrice: Number(product.defectSalePrice ?? product.defectPrice ?? product.price ?? product.cost ?? 0),
  });
  return rows;
};

const defectQuantityById = (product, defectId) => defectSaleRows(product).find((row) => row.defectId === String(defectId))?.defectLotQuantity || 0;
const posCartKeyFor = (productId, addressId, defectId) => `${cartKeyFor(productId, addressId)}${defectId ? `::brak:${defectId}` : ""}`;

const capitalizeCustomerName = (name) => String(name || "").trim().replace(/\s+/g, " ").split(" ").map((word) => word ? word[0].toLocaleUpperCase("uz-UZ") + word.slice(1).toLocaleLowerCase("uz-UZ") : "").join(" ");

const readPosCustomerSuggestions = (activeCustomerKey, activeSalesKey, query, selectedPhone) => {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("uz-UZ");
  if (!normalizedQuery) return [];
  const queryPhone = phoneDigits(query);
  const records = [];
  [...new Set([activeCustomerKey, "crm_customers", "crm_additional_pos_customers"])].forEach((key) => {
    if (!key) return;
    try {
      const saved = getData(key, []);
      if (Array.isArray(saved)) records.push(...saved);
    } catch {}
  });
  [...new Set([activeSalesKey, "crm_sales", "crm_additional_pos_sales"])].forEach((key) => {
    if (!key) return;
    try {
      const saved = getData(key, []);
      if (Array.isArray(saved)) records.push(...saved);
    } catch {}
  });
  const unique = new Map();
  records.forEach((record) => {
    const name = String(record?.name || record?.customerName || record?.customer || record?.mijoz_ismi || record?.ism || "").trim();
    if (!name) return;
    const phone = phoneDigits(record?.phone || record?.customerPhone || record?.mijoz_telefon || record?.telefon);
    const normalizedName = name.toLocaleLowerCase("uz-UZ");
    if (!normalizedName.startsWith(normalizedQuery) && !(queryPhone && phone.startsWith(queryPhone))) return;
    if (normalizedName === normalizedQuery && (!phone || phone === phoneDigits(selectedPhone))) return;
    const key = phone || normalizedName;
    if (!unique.has(key)) unique.set(key, { name: capitalizeCustomerName(name), phone });
  });
  const matches = [...unique.values()];
  return matches.sort((a, b) => a.name.localeCompare(b.name, "uz", { sensitivity: "base" })).slice(0, 8);
};
export default function POS({ cartWindowOpen = false, onCartWindowChange, draftKey = POS_DRAFT_KEY, onDraftChange, onBusyChange, onSaveSaleDraft, onSaleComplete, saveDraftActionRef, hideSaveDraftButton = false, draftOpenedAt, sourceSaleDraftId = null, salesStorageKey = "crm_sales", customerStorageKey = "crm_customers", salesDocumentType = "sales", currentUser = null, orderMode = false, headingText, initialOrderDraft = null, reservationOrderId = null, onSaveOrder, saveOrderActionRef, onOrderSaveAvailabilityChange, onOrderSaleComplete, onSaleActionComplete, saleSection = "", saleSectionLabel = null, initialDefectItem = null, onDefectSaleStarted }) {
  useUILanguage();
  const companyName = useTenantCompanyName();
  const { t } = useLanguage();
  const { success, warning } = useToast();
  const draftData = initialOrderDraft || readPosDraft(draftKey);
  const [activeReservationOrderId, setActiveReservationOrderId] = useState(() => reservationOrderId || draftData.sourceOrderId || null);
  const activeReservedOrder = activeReservationOrderId ? readOrders().find((order) => String(order.id) === String(activeReservationOrderId) && order.status === "reserved") || null : null;
  const previouslyPaidAmount = Number(activeReservedOrder?.advancePayment || 0);
  const previousDefectModeRef = useRef(normalizeProductText(saleSection) === "brak");

  const text = (key, fallback) =>
    t ? t(`pos.${key}`, fallback) : fallback;
  const isDefectSale = normalizeProductText(saleSection) === "brak";

  /* =====================================================
     PRODUCTS
  ===================================================== */

  const [productList, setProductList] = useState(() => {
    // Mahsulotlar Supabase'dagi "mahsulotlar" jadvalidan (bolimlar/mahsulotlar.js)
    const saved = getProducts(null);
    return Array.isArray(saved) ? saved : [];
  });
  const [reservedStock, setReservedStock] = useState(() => readReservedQuantitiesByCondition(activeReservationOrderId));

  const [categoryFilter, setCategoryFilter] = useState({ category: "", product: null, query: "" });
  useEffect(() => { const refresh = () => { try { const products = getProducts(); if (Array.isArray(products)) setProductList(products); } catch {} }; window.addEventListener("crm-products-updated", refresh); window.addEventListener("storage", refresh); return () => { window.removeEventListener("crm-products-updated", refresh); window.removeEventListener("storage", refresh); }; }, []);
  useEffect(() => { const refresh = () => setReservedStock(readReservedQuantitiesByCondition(activeReservationOrderId)); refresh(); window.addEventListener("crm-orders-updated", refresh); window.addEventListener("storage", refresh); return () => { window.removeEventListener("crm-orders-updated", refresh); window.removeEventListener("storage", refresh); }; }, [activeReservationOrderId]);
  const [search, setSearch] = useState("");
  const [quickAddProduct, setQuickAddProduct] = useState(null);
  const [quickAddQuantity, setQuickAddQuantity] = useState("1");
  const [quickAddInitialDefectId, setQuickAddInitialDefectId] = useState(null);
  const [suppliers] = useState(() => {
    try {
      const saved = getSuppliers(null);
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [selectedProductSelect] =
    useState("");
  const productsGridRef = useRef(null);
  // POS ko'rinishi:
  //  - kompyuterda har doim 3 ustun (mahsulotlar | savatcha | buyurtma) — brauzer masshtabi (Ctrl +)
  //    oshirilsa ham saqlanadi; joy yetmasa ustunlar siqilmaydi, sahifa yonga suriladi;
  //  - pastdagi ko'k "Savatcha" tugmasi faqat telefon/planshetda yoki oynaning o'zi tor bo'lsa chiqadi.
  // Masshtabni oyna torligidan ajratish uchun window.outerWidth ishlatiladi: u Ctrl + bilan o'zgarmaydi.
  const POS_WIDE_MIN = 940, POS_PHONE_WINDOW = 900;
  const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const isPhoneWindow = () => (window.outerWidth || window.innerWidth) < POS_PHONE_WINDOW;
  const posContainerRef = useRef(null);
  const [compactCart, setCompactCart] = useState(() => isPhoneWindow() || (isTouchDevice() && window.innerWidth < 1100));
  const compactRef = useRef(compactCart);
  const cartToggleRef = useRef(null);
  const cartWindowBodyRef = useRef(null);

  useLayoutEffect(() => {
    const element = posContainerRef.current;
    if (!element) return undefined;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      const narrow = width < (compactRef.current ? POS_WIDE_MIN + 40 : POS_WIDE_MIN);
      const nextCompact = isPhoneWindow() || (narrow && isTouchDevice());
      if (nextCompact === compactRef.current) return;
      compactRef.current = nextCompact;
      setCompactCart(nextCompact);
      if (!nextCompact) onCartWindowChange?.(false);
    };
    measure();
    const touchQuery = window.matchMedia?.("(pointer: coarse)");
    touchQuery?.addEventListener?.("change", measure);
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); touchQuery?.removeEventListener?.("change", measure); };
  }, [onCartWindowChange]);

  useLayoutEffect(() => {
    if (productsGridRef.current) productsGridRef.current.scrollTop = 0;
  }, [search, selectedProductSelect, productList.length, isDefectSale]);

  /* =====================================================
     CART
  ===================================================== */
  const reservedDefectQuantity = (productId, defectId, reservations = reservedStock) => {
    const id = String(productId), lots = reservations.defectiveLots || {};
    const matchingLotQuantity = Number(lots[defectReservationKey(id, defectId)] || 0);
    const trackedLotQuantity = Object.entries(lots).filter(([key]) => key.startsWith(`${id}::`)).reduce((sum, [, quantity]) => sum + Number(quantity || 0), 0);
    const unassignedQuantity = Math.max(0, Number(reservations.defective?.[id] || 0) - trackedLotQuantity);
    return matchingLotQuantity + unassignedQuantity;
  };
  const availableDefectStock = (product, defectId, reservations = reservedStock) => Math.max(0, defectQuantityById(product, defectId) - reservedDefectQuantity(product?.id, defectId, reservations));
  const availableStock = (product) => product?.defectId || isDefectSale
    ? availableDefectStock(product, product.defectId)
    : Math.max(0, Number(product?.stock || 0) - actualDefectiveStock(product) - Number(reservedStock.good?.[String(product?.id)] || 0));
  // Sotuvda yaroqli tovarni ombordagi qoldiqdan ko'p sotish mumkin: yetmagan qismi qo'shnidan olinadi
  // va "Qarzdagi tovar" bo'limiga yoziladi. Buyurtma (band qilish) va brak sotuvida cheklov saqlanadi.
  const allowBorrow = !orderMode;
  const ownAvailableStock = (product, reservations) => Math.max(0, Number(product?.stock || 0) - actualDefectiveStock(product) - Number(reservations?.good?.[String(product?.id)] || 0));
  const findInsufficientCartItem = (items, products, reservations, borrow = false) => {
    const requested = new Map();
    items.forEach((item) => {
      const defective = Boolean(item.isDefectSale || item.defectId), key = JSON.stringify([defective ? "defective" : "good", String(item.id), defective ? String(item.defectId || "") : ""]);
      const entry = requested.get(key) || { ...item, defective, requested: 0 };
      entry.requested += Number(item.qty || 0);
      requested.set(key, entry);
    });
    return [...requested.values()].find((item) => {
      if (borrow && !item.defective) return false;
      const product = products.find((entry) => String(entry.id) === String(item.id));
      const available = item.defective
        ? availableDefectStock(product, item.defectId, reservations)
        : Math.max(0, Number(product?.stock || 0) - actualDefectiveStock(product) - Number(reservations.good?.[String(item.id)] || 0));
      return item.requested > available;
    });
  };

  const [cart, setCart] = useState(() => {
    const saved = draftData.cart;
    if (!Array.isArray(saved)) return [];
    return isDefectSale ? saved.filter((item) => Boolean(item.isDefectSale && item.defectId)) : saved;
  });
  const cartProductCount = uniqueProductCount(cart);
  const consumedDefectItemKeyRef = useRef(null);
  useEffect(() => {
    if (!initialDefectItem) {
      consumedDefectItemKeyRef.current = null;
      return;
    }
    const defectId = String(initialDefectItem.defectId || "");
    const product = productList.find((item) => String(item.id) === String(initialDefectItem.productId));
    const requestKey = `${initialDefectItem.productId}::${defectId}`;
    if (!defectId || !product || consumedDefectItemKeyRef.current === requestKey) return;
    consumedDefectItemKeyRef.current = requestKey;
    setQuickAddProduct(product);
    // Braklar ro'yxatidan sotuvga o'tilganda oddiy mahsulot miqdori nol bo'lsin;
    // modal faqat tanlangan brakni savatga qo'shadi.
    setQuickAddQuantity("0");
    setQuickAddInitialDefectId(defectId);
    onDefectSaleStarted?.();
  }, [initialDefectItem, onDefectSaleStarted, productList]);

  const [globalDiscount, setGlobalDiscount] =
    useState(() => Number(draftData.globalDiscount) || 0);
  useEffect(() => {
    if (previousDefectModeRef.current === isDefectSale) return;
    previousDefectModeRef.current = isDefectSale;
    setCart([]);
    setGlobalDiscount(0);
    setCategoryFilter({ category: "", product: null, query: "" });
    setSearch("");
    setQuickAddProduct(null);
    setQuickAddInitialDefectId(null);
  }, [isDefectSale]);

  /* =====================================================
     CUSTOMER
  ===================================================== */

  const [customerName, setCustomerName] =
    useState(() => capitalizeCustomerName(draftData.customerName || ""));

  const [customerPhone, setCustomerPhone] =
    useState(() => phoneDigits(draftData.customerPhone || ""));

  const [customerError, setCustomerError] =
    useState("");

  const [deliveryAddress, setDeliveryAddress] = useState(() => draftData.deliveryAddress || "");
  const [addresses, setAddresses] = useState(() => {
    const saved = draftData.addresses;
    return Array.isArray(saved) ? saved.map((address) => ({ ...address, deliveryDate: address.deliveryDate ?? todayForDateInput() })) : [];
  });
  const [deliveryDate, setDeliveryDate] = useState(() => draftData.deliveryDate ?? draftData.addresses?.[0]?.deliveryDate ?? todayForDateInput());
  const [deliveryDateSelected, setDeliveryDateSelected] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState(() => draftData.selectedAddressId || draftData.addresses?.[0]?.id || null);
  const [addressConfirmed, setAddressConfirmed] = useState(() => Boolean(draftData.addressConfirmed));
  const [addressError, setAddressError] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [reserveConfirmOpen, setReserveConfirmOpen] = useState(false);
  const [advancePayment, setAdvancePayment] = useState(() => initialOrderDraft?.advancePayment ? String(initialOrderDraft.advancePayment) : "");
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState(() => initialOrderDraft?.advancePaymentMethod || "");
  const [selectedAdvanceCardId, setSelectedAdvanceCardId] = useState(() => initialOrderDraft?.advanceReceivingCard?.id || "");
  useEffect(() => {
    if (compactCart) cartWindowBodyRef.current?.scrollTo({ top: 0 });
  }, [paymentOpen, compactCart]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [completedSale, setCompletedSale] = useState(null);
  const [debtDueDate, setDebtDueDate] = useState(getDefaultDebtDueDate);
  const [paymentError, setPaymentError] = useState("");
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [showPaymentAnimation, setShowPaymentAnimation] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);
  const paymentTimerRef = useRef(null);
  const paymentSoundRef = useRef(null);
  const paymentSubmittingRef = useRef(false);

  useEffect(() => {
    try {
      if (orderMode) return;
      if (paymentComplete) {
        removeData(draftKey);
      } else {
        setData(draftKey, {
          cart, globalDiscount, customerName, customerPhone,
          deliveryAddress, addresses, deliveryDate, selectedAddressId, addressConfirmed,
          sourceOrderId: activeReservationOrderId,
        });
      }
    } catch { /* The sale can still be completed if browser storage is full. */ }
  },[cart, globalDiscount, customerName, customerPhone, deliveryAddress,
    addresses, deliveryDate, selectedAddressId, addressConfirmed, paymentComplete, draftKey, orderMode, activeReservationOrderId]);

  useEffect(() => { onDraftChange?.({ customerName, customerPhone, count: cartProductCount }); }, [customerName, customerPhone, cartProductCount, onDraftChange]);


  useEffect(() => {
    const sound = new Audio(checkAnimationSound);
    sound.preload = "auto";
    paymentSoundRef.current = sound;

    return () => {
      clearTimeout(paymentTimerRef.current);
      sound.pause();
      sound.currentTime = 0;
      paymentSoundRef.current = null;
    };
  }, []);

  /* =====================================================
     PRODUCT MODAL
  ===================================================== */

  const [isModalOpen, setIsModalOpen] =
    useState(false);

  const [editingProduct, setEditingProduct] =
    useState(null);

  /* =====================================================
     DELETE
  ===================================================== */

  const [deleteModalOpen, setDeleteModalOpen] =
    useState(false);

  const [productToDeleteId, setProductToDeleteId] =
    useState(null);

  /* =====================================================
     RECEIPT
  ===================================================== */

  const [receiptOpen, setReceiptOpen] =
    useState(false);

  useEffect(() => { onBusyChange?.(paymentOpen || !!quickAddProduct || receiptOpen || saveDraftOpen || reserveConfirmOpen); }, [paymentOpen, quickAddProduct, receiptOpen, saveDraftOpen, reserveConfirmOpen, onBusyChange]);

  const [receiptNumber, setReceiptNumber] =
    useState("");

  const [receiptDate, setReceiptDate] =
    useState("");

  /* =====================================================
     FORM
  ===================================================== */

  const [formData, setFormData] = useState({
    name: "",
    category: "Maishiy kimyo",
    price: "",
    stock: "",
    image: "??",
  });

  /* =====================================================
     FILTER
  ===================================================== */

  const saleProducts = isDefectSale ? productList.flatMap(defectSaleRows) : productList;
  const filtered = saleProducts.filter((p) => {
    const matchSearch = [p.id, p.sku, p.name, p.category].some((value) => normalizeProductText(value).startsWith(normalizeProductText(search)));

    const matchSelect =
      !selectedProductSelect ||
      p.id.toString() ===
      selectedProductSelect;

    return matchSearch && matchSelect && saleMatchesProduct({ items: [p] }, productList, categoryFilter);
  }).sort((a, b) => a.name.localeCompare(b.name, "uz", { sensitivity: "base", numeric: true }));

  /* Bazada bir xil mahsulot (nomi + SKU + brend bir xil) bir necha qator bo'lib qolgan bo'lsa,
     POS'da faqat bittasi ko'rinsin: qoldig'i bor qatorlar ko'rsatiladi, tugaganlari yashiriladi.
     Hammasi tugagan bo'lsa — bitta "Tugagan" kartasi qoladi. */
  const productDuplicateKey = (p) => [p.name, p.sku, p.brand].map(normalizeProductText).join("|");
  const visibleProducts = isDefectSale ? filtered : (() => {
    const groups = new Map();
    filtered.forEach((p) => {
      const key = productDuplicateKey(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    const keep = new Set();
    groups.forEach((items) => {
      const inStock = items.filter((p) => availableStock(p) > 0 || cart.some((c) => String(c.id) === String(p.id) && !c.defectId));
      if (inStock.length) inStock.forEach((p) => keep.add(p));
      else keep.add(items.reduce((best, p) => (Number(p.stock || 0) > Number(best.stock || 0) ? p : best), items[0]));
    });
    return filtered.filter((p) => keep.has(p));
  })();

  const assignUnassignedItems = (addressId) => {
    setCart((previous) => previous.map((item) =>
      item.addressId
        ? item
        : { ...item, addressId, cartKey: posCartKeyFor(item.id, addressId, item.defectId) }
    ));
  };

  const addDeliveryAddress = (details) => {
    const newAddress = { id: createAddressId(), ...details, deliveryDate: details.deliveryDate ?? todayForDateInput(), deliveryDateConfirmed: Boolean(details.deliveryDateConfirmed) };
    if (addresses.length === 0) {
      const typedAddress = deliveryAddress.trim();
      if (typedAddress) {
        const primary = {
          id: createAddressId(),
          name: "Asosiy manzil",
          address: typedAddress,
          phone: "",
          deliveryDate,
          deliveryDateConfirmed: false,
        };
        setAddresses([primary, newAddress]);
        assignUnassignedItems(primary.id);
      } else {
        setAddresses([newAddress]);
        setDeliveryAddress(newAddress.address);
        assignUnassignedItems(newAddress.id);
      }
    } else {
      const currentAddresses = addresses.length === 1 && deliveryAddress.trim()
        ? [{ ...addresses[0], address: deliveryAddress.trim() }]
        : addresses;
      setAddresses([...currentAddresses, newAddress]);
    }
    setDeliveryDate(newAddress.deliveryDate);
    setSelectedAddressId(newAddress.id);
    setAddressConfirmed(false);
    setAddressError("");
  };

  const confirmDeliveryAddresses = () => {
    if (addresses.length > 1) {
      if (!selectedAddressId) {
        setAddressError("Yetkazib berish manzilini tanlang.");
        return false;
      }
      const confirmedAddresses = addresses.map((address) => address.id === selectedAddressId
        ? { ...address, deliveryDateConfirmed: true }
        : address);
      setAddresses(confirmedAddresses);
      setAddressError("");
      const currentIndex = addresses.findIndex((address) => address.id === selectedAddressId);
      const nextAddress = [...confirmedAddresses.slice(currentIndex + 1), ...confirmedAddresses.slice(0, currentIndex)]
        .find((address) => !address.deliveryDateConfirmed);
      if (nextAddress) {
        setSelectedAddressId(nextAddress.id);
        setAddressConfirmed(false);
      } else {
        setAddressConfirmed(true);
      }
      return true;
    }

    const addressText = deliveryAddress.trim();
    if (addresses.length === 0) {
      if (addressText) {
        const id = createAddressId();
        setAddresses([{ id, name: "Asosiy manzil", address: addressText, phone: "", deliveryDate, deliveryDateConfirmed: false }]);
        setSelectedAddressId(id);
        assignUnassignedItems(id);
      }
    } else {
      setAddresses([{ ...addresses[0], address: addressText || addresses[0].address }]);
      setSelectedAddressId(addresses[0].id);
    }
    setAddressError("");
    setAddressConfirmed(Boolean(addressText || addresses.length));
    return true;
  };

  const moveItemToAddress = (cartKey, addressId) => {
    if (!addresses.some((address) => address.id === addressId)) return;
    setCart((previous) => {
      const item = previous.find((entry) => entry.cartKey === cartKey);
      if (!item || item.addressId === addressId) return previous;
    const nextKey = posCartKeyFor(item.id, addressId, item.defectId);
      const existing = previous.find((entry) => entry.cartKey === nextKey);
      if (existing) {
        return previous
          .filter((entry) => entry.cartKey !== cartKey)
          .map((entry) => entry.cartKey === nextKey
            ? { ...entry, qty: entry.qty + item.qty }
            : entry);
      }
      return previous.map((entry) => entry.cartKey === cartKey
        ? { ...entry, addressId, cartKey: nextKey }
        : entry);
    });
  };

  /* =====================================================
     ADD TO CART
  ===================================================== */

  const addToCart = (p, quantity = 1, selectedDefects = []) => {
    const mainQuantity = Math.floor(Number(quantity));
    const lines = [];
    if (Number.isFinite(mainQuantity) && mainQuantity > 0) lines.push({ product: p, quantity: mainQuantity });
    (Array.isArray(selectedDefects) ? selectedDefects : []).forEach(({ product, quantity: defectQuantity }) => {
      const requested = Math.floor(Number(defectQuantity));
      if (product && Number.isFinite(requested) && requested > 0) lines.push({ product, quantity: requested });
    });
    if (!lines.length) return false;

    for (const line of lines) {
      const defectLine = Boolean(line.product?.defectId);
      if (allowBorrow && !defectLine) continue;
      const available = availableStock(line.product);
      if (available <= 0) {
        warning("Mahsulot tugagan", `${line.product.name} hozir omborda mavjud emas.`);
        return false;
      }
      const totalInCart = cart
        .filter((item) => item.id === line.product.id && (defectLine ? item.isDefectSale && item.defectId === line.product.defectId : !item.isDefectSale))
        .reduce((sum, item) => sum + item.qty, 0);
      if (totalInCart + line.quantity > available) {
        warning("Miqdor cheklangan", `${line.product.name} uchun ombordagi qoldiq yetarli emas.`);
        return false;
      }
    }

    setCart((previous) => {
      const addressId = selectedAddressId || addresses[0]?.id || null;
      return lines.reduce((next, line) => {
        const item = line.product;
        const defectLine = Boolean(item.defectId);
        const cartKey = posCartKeyFor(item.id, addressId, defectLine ? item.defectId : null);
        const existing = next.find((entry) => entry.cartKey === cartKey);
        if (existing) {
          return next.map((entry) => entry.cartKey === cartKey ? { ...entry, qty: entry.qty + line.quantity } : entry);
        }
        return [...next, {
          id: item.id,
          cartKey,
          addressId,
          name: item.name,
          price: Number(defectLine ? item.defectPrice : item.price),
          image: item.image,
          qty: line.quantity,
          discount: 0,
          ...(defectLine ? { defectId: item.defectId, defectStatus: item.defectStatus, defectReason: item.defectReason, isDefectSale: true } : {}),
        }];
      }, [...previous]);
    });
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    success("Mahsulot qo'shildi", `${p.name} va tanlangan braklar savatchaga ${itemCount} dona qo'shildi.`);
    return true;
  };

  const openQuickAdd = (product) => {
    setQuickAddProduct(product);
    setQuickAddQuantity("1");
    setQuickAddInitialDefectId(null);
  };

  const closeQuickAdd = () => {
    setQuickAddProduct(null);
    setQuickAddInitialDefectId(null);
  };

  const confirmQuickAdd = (quantity, defectLines = []) => {
    if (addToCart(quickAddProduct, quantity, defectLines)) setQuickAddProduct(null);
  };

  /* =====================================================
     UPDATE QTY
  ===================================================== */

  const updateQty = (cartKey, delta) => {
    setCart((previous) => {
      const current = previous.find((item) => item.cartKey === cartKey);
      if (!current) return previous;
      const product = productList.find((item) => item.id === current.id);
      const otherQty = previous
        .filter((item) => item.id === current.id && (current.isDefectSale ? item.defectId === current.defectId : !item.isDefectSale) && item.cartKey !== cartKey)
        .reduce((sum, item) => sum + item.qty, 0);
      const available = allowBorrow && !current.isDefectSale ? Infinity : product ? (current.isDefectSale ? availableDefectStock(product, current.defectId) : availableStock(product)) - otherQty : Infinity;
      const nextQty = Math.max(0, Math.min(current.qty + delta, available));
      return previous
        .map((item) => item.cartKey === cartKey ? { ...item, qty: nextQty } : item)
        .filter((item) => item.qty > 0);
    });
  };

  /* =====================================================
     EXACT QTY
  ===================================================== */

  const setExactQty = (cartKey, newQty) => {
    setCart((previous) => {
      const current = previous.find((item) => item.cartKey === cartKey);
      if (!current) return previous;
      const product = productList.find((item) => item.id === current.id);
      const otherQty = previous
        .filter((item) => item.id === current.id && (current.isDefectSale ? item.defectId === current.defectId : !item.isDefectSale) && item.cartKey !== cartKey)
        .reduce((sum, item) => sum + item.qty, 0);
      const available = allowBorrow && !current.isDefectSale ? Infinity : product ? (current.isDefectSale ? availableDefectStock(product, current.defectId) : availableStock(product)) - otherQty : Infinity;
      const nextQty = Math.max(0, Math.min(newQty, available));
      return previous
        .map((item) => item.cartKey === cartKey ? { ...item, qty: nextQty } : item)
        .filter((item) => item.qty > 0);
    });
  };

  /* =====================================================
     REMOVE
  ===================================================== */

  const removeItem = (cartKey) => {
    setCart((prev) =>
      prev.filter((c) => c.cartKey !== cartKey)
    );
  };

  const clearCart = () => {
    setCart([]);
    setGlobalDiscount(0);
  };

  // "Band qilish": avval tekshiriladi va tasdiqlash oynasi chiqadi; haqiqiy saqlash confirmed === true bo'lganda bajariladi.
  const requestSaveOrder = (confirmed = false) => {
    if (!cart.length) { warning("Buyurtma bo‘sh", "Avval mahsulot tanlang."); return false; }
    if (!customerName.trim()) { setCustomerError("Mijoz ismini kiriting."); return false; }
    if (!/^\d{9}$/.test(phoneDigits(customerPhone))) { setCustomerError("Telefon raqamini 9 ta raqam bilan kiriting."); return false; }
    let products = productList;
    try { const savedProducts = getProducts(null); if (Array.isArray(savedProducts)) products = savedProducts; } catch {}
    const reservations = readReservedQuantitiesByCondition(activeReservationOrderId);
    const insufficient = findInsufficientCartItem(cart, products, reservations);
    if (insufficient) { setProductList(products); warning("Tovar yetarli emas", `${insufficient.name || "Mahsulot"}: band qilinmagan qoldiqdan ko‘p miqdor kiritildi.`); return false; }
    if (confirmed !== true) { setCustomerError(""); setReserveConfirmOpen(true); return true; }
    const advancePaymentAmount = Math.min(Math.max(0, Math.round(total)), toBaseMoney(advancePayment));
    if (advancePaymentAmount > 0 && !advancePaymentMethod) { warning("To‘lov usulini tanlang", "Oldindan to‘lov uchun naqd yoki kartani tanlang."); setReserveConfirmOpen(true); return false; }
    let advanceReceivingCard = null;
    if (advancePaymentAmount > 0 && advancePaymentMethod === "card") {
      try {
        const existingAdvance = Number(initialOrderDraft?.advancePayment || 0);
        const savedSnapshot = initialOrderDraft?.advanceReceivingCard;
        advanceReceivingCard = selectedAdvanceCardId
          ? resolveReceivingCard(selectedAdvanceCardId)
          : savedSnapshot && savedSnapshot.id === initialOrderDraft?.advanceReceivingCard?.id && advancePaymentAmount === existingAdvance
            ? savedSnapshot
            : resolveReceivingCard("");
      } catch (cause) {
        warning(cause.message || "Pul qabul qiluvchi kartani tanlang.", "Oldindan to‘lovni qabul qilish kartasini tanlang.");
        setReserveConfirmOpen(true);
        return false;
      }
    }
    const now = new Date().toISOString();
    const reservedAdvancePayment = advancePaymentAmount;
    const previousOrder = activeReservationOrderId ? readOrders().find((item) => String(item.id) === String(activeReservationOrderId)) : null;
    const advanceUnchanged = previousOrder
      && Number(previousOrder.advancePayment || 0) === reservedAdvancePayment
      && (previousOrder.advancePaymentMethod || null) === (reservedAdvancePayment > 0 ? advancePaymentMethod : null)
      && (previousOrder.advanceReceivingCard?.number || "") === (advanceReceivingCard?.number || "");
    const saved = onSaveOrder?.({
      id: activeReservationOrderId || crypto.randomUUID(),
      orderNumber: initialOrderDraft?.orderNumber || ("B-" + Date.now().toString().slice(-6)),
      status: "reserved",
      cart,
      customerName: customerName.trim(),
      customerPhone: phoneDigits(customerPhone),
      globalDiscount,
      subtotal,
      discountAmount: discountAmt,
      total: Math.round(total),
      advancePayment: reservedAdvancePayment,
      advancePaymentMethod: reservedAdvancePayment > 0 ? advancePaymentMethod : null,
      advanceReceivingCard: reservedAdvancePayment > 0 ? advanceReceivingCard : null,
      advancePaymentDate: reservedAdvancePayment > 0 ? (advanceUnchanged ? previousOrder.advancePaymentDate || previousOrder.updatedAt || now : now) : null,
      deliveryAddress,
      deliveryDate,
      addresses,
      deliveryAddresses: addresses,
      selectedAddressId,
      addressConfirmed,
      employeeId: currentUser?.type === "employee" ? currentUser.id : null,
      employeeName: currentUser?.type === "employee" ? currentUser.name : "",
      openedAt: initialOrderDraft?.openedAt || draftOpenedAt || now,
      updatedAt: now,
      createdAt: initialOrderDraft?.createdAt || now,
    });
    if (!saved) { warning("Buyurtma saqlanmadi", "Ma’lumotni saqlash imkoni bo‘lmadi. Qayta urinib ko‘ring."); return false; }
    if (sourceSaleDraftId) deleteSaleDraft(sourceSaleDraftId);
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerError("");
    setDeliveryAddress("");
    setDeliveryDate(todayForDateInput());
    setAddresses([]);
    setSelectedAddressId(null);
    setAddressConfirmed(false);
    setAddressError("");
    setGlobalDiscount(0);
    setAdvancePayment("");
    setAdvancePaymentMethod("");
    setSelectedAdvanceCardId("");
    success("Buyurtma vaqtincha saqlandi", "Mahsulotlar buyurtma uchun band qilindi.");
    onSaleActionComplete?.("Band qilingan");
    return true;
  };
  if (saveOrderActionRef) saveOrderActionRef.current = requestSaveOrder;

  const requestSaveSaleDraft = () => {
    if (!cart.length) {
      warning("Savatcha bo‘sh", "Saqlash uchun avval mahsulot tanlang.");
      return;
    }
    setCustomerError("");
    setSaveDraftOpen(true);
  };
  if (saveDraftActionRef) saveDraftActionRef.current = requestSaveSaleDraft;

  const confirmSaveSaleDraft = () => {
    const saved = onSaveSaleDraft?.({
      id: sourceSaleDraftId || crypto.randomUUID(),
      cart,
      customerName: customerName.trim(),
      customerPhone,
      globalDiscount,
      deliveryAddress,
      deliveryDate,
      addresses,
      selectedAddressId,
      addressConfirmed,
      saleSection: saleSectionLabel ?? saleSection,
      openedAt: draftOpenedAt || new Date().toISOString(),
      savedAt: new Date().toISOString(),
    });
    if (!saved) {
      warning("Sotuv saqlanmadi", "Xotirada joy yetarli emas. Qayta urinib ko‘ring.");
      return;
    }
    setSaveDraftOpen(false);
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerError("");
    setDeliveryAddress("");
    setDeliveryDate(todayForDateInput());
    setAddresses([]);
    setSelectedAddressId(null);
    setAddressConfirmed(false);
    setAddressError("");
    setGlobalDiscount(0);
    if (activeReservationOrderId) {
      removeOrder(activeReservationOrderId);
      setActiveReservationOrderId(null);
    }
    success("Sotuv qoralamaga saqlandi", "Saqlangan sotuvni Qoralama bo‘limidan davom ettirishingiz mumkin.");
    onSaleActionComplete?.("Qoralama");
  };

  /* =====================================================
     EDIT PRODUCT
  ===================================================== */


  /* =====================================================
     DELETE MODAL
  ===================================================== */


  const confirmDeleteProduct = () => {
    if (productToDeleteId !== null) {
      const updated =
        productList.filter(
          (p) =>
            p.id !== productToDeleteId
        );

      setProductList(updated);

      saveProducts(updated);

      setCart((prev) =>
        prev.filter(
          (item) =>
            item.id !== productToDeleteId
        )
      );
    }

    setDeleteModalOpen(false);
    setProductToDeleteId(null);
  };

  const cancelDeleteProduct = () => {
    setDeleteModalOpen(false);
    setProductToDeleteId(null);
  };

  /* =====================================================
     CLOSE PRODUCT MODAL
  ===================================================== */

  const closeProductModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
  };

  /* =====================================================
     SAVE PRODUCT
  ===================================================== */

  const handleSaveProduct = (e) => {
    e.preventDefault();

    if (
      !formData.name.trim() ||
      !formData.price
    ) {
      return;
    }

    if (editingProduct) {
      const updated = productList.map(
        (p) =>
          p.id === editingProduct.id
            ? {
              ...p,
              ...formData,
              name: formData.name.trim(),
              price: Number(
                formData.price
              ),
              stock: Number(
                formData.stock
              ),
            }
            : p
      );

      setProductList(updated);

      saveProducts(updated);
      const editedStock = Math.max(0, Number(formData.stock) || 0);
      setCart((previous) => {
        let remaining = editedStock;
        return previous.map((item) => {
          if (item.id !== editingProduct.id) return item;
          const qty = Math.min(item.qty, remaining);
          remaining -= qty;
          return {
            ...item,
            name: formData.name.trim(),
            price: Number(formData.price),
            image: formData.image,
            qty,
          };
        }).filter((item) => item.qty > 0);
      });
    } else {
      const newProduct = {
        id: Date.now(),
        ...formData,
        name: formData.name.trim(),
        price: Number(formData.price),
        stock:
          Number(formData.stock) || 0,
      };

      const updated = [
        newProduct,
        ...productList,
      ];

      setProductList(updated);

      saveProducts(updated);
    }

    closeProductModal();
  };

  /* =====================================================
     TOTALS
  ===================================================== */

  const subtotal = cart.reduce(
    (sum, c) =>
      sum +
      Number(c.price) *
      Number(c.qty) *
      (1 -
        Number(c.discount || 0) / 100),
    0
  );

  const discountAmt =
    subtotal *
    (Number(globalDiscount) / 100);

  const total = Math.max(
    0,
    subtotal - discountAmt
  );

  const cartCount = cart.reduce(
    (sum, c) => sum + c.qty,
    0
  );
  const canSaveOrder = Boolean(orderMode && cart.length && customerName.trim() && /^\d{9}$/.test(phoneDigits(customerPhone)));
  useEffect(() => { onOrderSaveAvailabilityChange?.(canSaveOrder); }, [canSaveOrder, onOrderSaveAvailabilityChange]);

  const savedReceiptAddresses = completedSale?.deliveryAddresses?.length
    ? completedSale.deliveryAddresses
    : addresses;
  const receiptAddressRows = savedReceiptAddresses
    .filter((address) => address.address?.trim() || address.deliveryDate)
    .map((address) => ({ address: address.address?.trim() || "—", deliveryDate: address.deliveryDate || "" }));
  if (!receiptAddressRows.length) {
    const address = completedSale?.deliveryAddress || deliveryAddress;
    const scheduledDate = completedSale?.items?.find((item) => item.deliveryDate)?.deliveryDate || (deliveryDateSelected ? deliveryDate : "");
    if (address?.trim() || scheduledDate) receiptAddressRows.push({ address: address?.trim() || "—", deliveryDate: scheduledDate });
  }
  /* =====================================================
     RECEIPT OPEN
  ===================================================== */

  const handleOpenReceipt = () => {
    if (cart.length === 0) {
      return;
    }

    const trimmedName =
      customerName.trim();

    if (!trimmedName) {
      setCustomerError(
        "Avval mijoz ismini kiriting!"
      );
      return;
    }

    if (customerPhone && !/^\d{9}$/.test(customerPhone)) {
      setCustomerError("Telefon raqamini 9 ta raqam bilan kiriting.");
      return;
    }

    setCustomerError("");

    const now = new Date();

    const receiptId =
      `CHK-${now.getTime()}`;

    const formattedDate =
      now.toLocaleString("uz-UZ", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

    setReceiptNumber(receiptId);
    setReceiptDate(formattedDate);

    setReceiptOpen(true);
  };

  /* =====================================================
     CLOSE RECEIPT
  ===================================================== */

  const handleCloseReceipt = () => {
    if (paymentComplete) {
      handleNewSale();
      return;
    }
    setReceiptOpen(false);
  };

  /* =====================================================
     PRINT RECEIPT
  ===================================================== */

  const handlePrintReceipt = () => {
    window.print();
  };

  /* =====================================================
     CHECKOUT
  ===================================================== */

  const handleCheckout = () => {
    if (cart.length === 0) {
      return;
    }

    const trimmedName =
      customerName.trim();

    const trimmedPhone =
      customerPhone.trim();

    if (!trimmedName) {
      setCustomerError(
        "Iltimos, mijoz ismini kiriting!"
      );
      return;
    }

    if (trimmedPhone && !/^\d{9}$/.test(trimmedPhone)) {
      setCustomerError("Telefon raqamini 9 ta raqam bilan kiriting.");
      return;
    }

    setCustomerError("");
    setAddressError("");
    setPaymentAmount(activeReservedOrder ? "" : orderMode ? String(Math.round(total)) : "");
    setPaymentMethod("cash");
    setSelectedCardId("");
    setDebtDueDate(getDefaultDebtDueDate());
    setPaymentError("");
    setPaymentComplete(false);
    setPaidAmount(0);
    setPaymentOpen(true);
  };

  const closePayment = () => {
    if (paymentComplete) {
      handleNewSale();
      return;
    }
    setPaymentOpen(false);
    setPaymentError("");
  };

  const confirmPayment = () => {
    if (!paymentOpen || paymentComplete || paymentSubmittingRef.current || cart.length === 0) return;
    const currentProducts = getProducts();
    const currentReservations = readReservedQuantitiesByCondition(activeReservationOrderId);
    const insufficient = findInsufficientCartItem(cart, currentProducts, currentReservations, allowBorrow);
    if (insufficient) { setProductList(currentProducts); setPaymentError(`${insufficient.name}: band qilinmagan mahsulot yetarli emas. Miqdorni kamaytiring.`); return; }
    const saleTotal = Math.round(total);
    const reservedOrder = activeReservationOrderId
      ? readOrders().find((order) => String(order.id) === String(activeReservationOrderId) && order.status === "reserved") || null
      : null;
    const priorAdvanceAmount = Math.min(saleTotal, Math.max(0, Number(reservedOrder?.advancePayment || 0)));
    const amount = paymentAmount === ""
      ? 0
      : Math.min(Math.max(0, saleTotal - priorAdvanceAmount), Math.max(0, Number(paymentAmount) || 0));
    const totalPaid = Math.min(saleTotal, priorAdvanceAmount + amount);
    if (totalPaid < saleTotal && !debtDueDate) {
      setPaymentError("Qolgan qarzni qaytarish muddatini tanlang.");
      return;
    }
    let receivingCard = null;
    if (amount > 0 && paymentMethod === "card") {
      try {
        receivingCard = resolveReceivingCard(selectedCardId);
      } catch (cause) {
        setPaymentError(cause.message);
        return;
      }
    }
    paymentSubmittingRef.current = true;
    const remainingDebt = Math.max(0, saleTotal - totalPaid);
    const trimmedName = capitalizeCustomerName(customerName.trim());
    const trimmedPhone = customerPhone.trim();
    const typedAddress = deliveryAddress.trim();

    const scheduledDeliveryDate = deliveryDateSelected ? deliveryDate : "";
    const checkoutAddresses = addresses.length === 0
      ? (typedAddress || scheduledDeliveryDate
        ? [{ id: createAddressId(), name: "Asosiy manzil", address: typedAddress, phone: "", deliveryDate: scheduledDeliveryDate }]
        : [])
      : addresses.length === 1
        ? [{ ...addresses[0], address: typedAddress || addresses[0].address, deliveryDate: scheduledDeliveryDate }]
        : addresses.map((address) => ({ ...address, deliveryDate: scheduledDeliveryDate }));
    const primaryAddress = checkoutAddresses[0]?.address || "";

    try {

    /* =================================================
       CUSTOMER
    ================================================= */

    const savedCustomers = getData(customerStorageKey, null);
    const customersList = savedCustomers !== null
      ? savedCustomers
      : customerStorageKey === "crm_additional_pos_customers"
        ? []
        : [];
    const existingIndex =
      customersList.findIndex(
        (c) =>
          c.name?.trim().toLowerCase() === trimmedName.toLowerCase() &&
          (trimmedPhone
            ? phoneDigits(c.phone) === trimmedPhone
            : phoneDigits(c.phone) === "")
      );

    let customerId;

    if (existingIndex !== -1) {
      customerId =
        customersList[existingIndex].id;

      const currentDebt = Number(customersList[existingIndex].debt || 0);
      const updatedDebt = currentDebt + remainingDebt;

      customersList[existingIndex] = {
        ...customersList[existingIndex],
        phone: trimmedPhone
          ? `+998 ${formatUzPhone(trimmedPhone)}`
          : customersList[
            existingIndex
          ].phone,
        purchases:
          Number(
            customersList[
              existingIndex
            ].purchases || 0
          ) + cartCount,
        spent:
          Number(
            customersList[
              existingIndex
            ].spent || 0
          ) + saleTotal,
        debt: updatedDebt,
        status: updatedDebt > 0 && customersList[existingIndex].status !== "vip"
          ? "debtor"
          : customersList[existingIndex].status,
        lastPurchase:
          new Date()
            .toISOString()
            .split("T")[0],
        address: primaryAddress,
      };
    } else {
      customerId = Date.now();

      const newCustomer = {
        id: customerId,
        name: trimmedName,
        phone: trimmedPhone
          ? `+998 ${formatUzPhone(trimmedPhone)}`
          : "Ko'rsatilmagan",
        region: "Toshkent",
        status: remainingDebt > 0 ? "debtor" : "active",
        purchases: cartCount,
        spent: saleTotal,
        debt: remainingDebt,
        lastPurchase:
          new Date()
            .toISOString()
            .split("T")[0],
        address: primaryAddress,
      };

      customersList.unshift(
        newCustomer
      );
    }

    setData(customerStorageKey, customersList);

    /* =================================================
       RECEIPT NUMBER
    ================================================= */

    const now = new Date();

    const saleReceiptNumber =
      receiptNumber ||
      `CHK-${now.getTime()}`;

    /* =================================================
       QO'SHNIDAN OLINGAN (ПЕРЕХОД) TOVARLAR
       Omborda yetmagan miqdor qo'shnidan olinadi. Chekka yozilmaydi — faqat "Qarzdagi tovar" bo'limida ko'rinadi.
    ================================================= */

    const borrowedByProduct = new Map();
    const borrowedItems = [];
    if (allowBorrow) {
      const normalQtyByProduct = new Map();
      cart.filter((item) => !item.isDefectSale).forEach((item) => normalQtyByProduct.set(String(item.id), (normalQtyByProduct.get(String(item.id)) || 0) + Number(item.qty || 0)));
      normalQtyByProduct.forEach((quantity, productId) => {
        const product = currentProducts.find((entry) => String(entry.id) === productId);
        const borrowed = Math.max(0, quantity - ownAvailableStock(product, currentReservations));
        if (!borrowed) return;
        borrowedByProduct.set(productId, borrowed);
        const line = cart.find((item) => String(item.id) === productId && !item.isDefectSale);
        const unitCost = Number(product?.cost || 0);
        borrowedItems.push({
          id: `PER-${now.getTime()}-${borrowedItems.length + 1}`,
          productId: product?.id ?? line?.id, productName: product?.name || line?.name || "", sku: product?.sku || "", brand: product?.brand || "", category: product?.category || "",
          unit: product?.measurementUnit || "dona", quantity: borrowed, soldQuantity: quantity, unitCost, total: borrowed * unitCost, salePrice: Number(line?.price || 0),
          status: "open", paidAmount: 0, payments: [], note: "", date: now.toISOString(),
        });
      });
    }

    /* =================================================
       SALE OBJECT
    ================================================= */

    const sale = {
      id: nextDocumentNumber(getData(salesStorageKey, []), salesDocumentType, now),

      receiptNumber:
        saleReceiptNumber,

      customerId,
      employeeId: currentUser?.type === "employee" ? currentUser.id : null,
      employeeName: currentUser?.type === "employee" ? currentUser.name : "",
      sourceOrderId: activeReservationOrderId || null,
      saleSection: saleSectionLabel ?? saleSection,
      isDefectSale,
      hasDefectItems: cart.some((item) => item.isDefectSale),
      customer: trimmedName,
      products: cartProductCount,
      productIds: [...new Set(cart.map((item) => item.id))],
      amount: saleTotal,
      paidAmount: totalPaid,
      initialPaidAmount: amount,
      debtBalance: remainingDebt,
      debtDueDate: remainingDebt > 0 ? debtDueDate : "",
      status: totalPaid === 0 ? "debt" : remainingDebt > 0 ? "partial" : "paid",
      payment: amount > 0 ? paymentMethod === "card" ? "Karta" : "Naqd" : priorAdvanceAmount > 0 ? reservedOrder?.advancePaymentMethod === "card" ? "Karta" : "Naqd" : "Qarz",
      receivingCard,
      cardLast4: receivingCard?.number.slice(-4) || "",

      customerName: trimmedName,

      customerPhone: trimmedPhone
        ? `+998 ${formatUzPhone(trimmedPhone)}`
        : "Ko'rsatilmagan",

      deliveryAddress: primaryAddress,
      deliveryAddresses: checkoutAddresses.map((address) => ({
        ...address,
        productCount: uniqueProductCount(cart.filter((item) => item.addressId === address.id)),
      })),

      items: cart.map((item) => {
        const itemAddressId = item.addressId || checkoutAddresses[0]?.id || null;
        const selectedDeliveryAddress = checkoutAddresses.find((address) => address.id === itemAddressId);
        const deliveryDate = scheduledDeliveryDate;
        const pickupPending = deliveryDateSelected && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate);
        return {
          id: item.id,
          addressId: itemAddressId,
          deliveryAddress: selectedDeliveryAddress?.address || primaryAddress,
          deliveryDate,
          deliveryStatus: pickupPending ? "waiting" : "delivered",
          name: item.name,
          price: Number(item.price),
          qty: Number(item.qty),
          ...(item.defectId ? { defectId: item.defectId, defectStatus: item.defectStatus, defectReason: item.defectReason, isDefectSale: true } : {}),
          total: Number(item.price) * Number(item.qty),
        };
      }),

      subtotal: Number(subtotal),

      discountPercent:
        Number(globalDiscount),

      discountAmount:
        Number(discountAmt),

      total: saleTotal,

      paymentMethod: amount > 0 ? paymentMethod === "card" ? "Karta" : "Naqd" : priorAdvanceAmount > 0 ? reservedOrder?.advancePaymentMethod === "card" ? "Karta" : "Naqd" : "Qarz",

      date:
        now.toISOString(),

      formattedDate:
        now.toLocaleString("uz-UZ"),
      ...(borrowedItems.length ? { borrowedItems } : {}),
    };

    /* =================================================
       SAVE SALES
    ================================================= */

    let salesList = getData(salesStorageKey, []);

    salesList.unshift(sale);

    setData(salesStorageKey, salesList);
    if (priorAdvanceAmount > 0 && reservedOrder) {
      saveDebtPayment({
        id: `RES-${reservedOrder.id}-${sale.id}`,
        saleId: sale.id,
        sourceOrderId: reservedOrder.id,
        customer: trimmedName,
        customerName: trimmedName,
        amount: priorAdvanceAmount,
        method: reservedOrder.advancePaymentMethod === "card" ? "Karta" : "Naqd",
        receivingCard: reservedOrder.advanceReceivingCard || null,
        cardLast4: reservedOrder.advanceReceivingCard?.number?.slice(-4) || "",
        createdAt: reservedOrder.advancePaymentDate || reservedOrder.updatedAt || now.toISOString(),
      });
    }

    /* =================================================
       UPDATE PRODUCTS STOCK
    ================================================= */

    const updatedProducts = currentProducts.map((p) => {
      const productLines = cart.filter((item) => String(item.id) === String(p.id));
      const purchasedQty = productLines.reduce((sum, item) => sum + Number(item.qty), 0);
      if (purchasedQty <= 0) return p;
      const defectLines = productLines.filter((item) => item.isDefectSale);
      const normalQuantity = productLines.filter((item) => !item.isDefectSale).reduce((sum, item) => sum + Number(item.qty), 0);
      const defectiveQuantity = defectLines.reduce((sum, item) => sum + Number(item.qty), 0);
      const borrowedQuantity = borrowedByProduct.get(String(p.id)) || 0;
      if (!defectiveQuantity) return { ...p, stock: Math.max(0, Number(p.stock) - (normalQuantity - borrowedQuantity)) };
      const soldByDefect = new Map();
      defectLines.forEach((item) => soldByDefect.set(String(item.defectId), (soldByDefect.get(String(item.defectId)) || 0) + Number(item.qty)));
      const updatedDefects = (Array.isArray(p.defects) ? p.defects : []).map((defect, index) => {
        const id = String(defect.id || `${p.id}-defect-${index}`);
        const quantity = Math.max(0, Number(defect.quantity || 0) - (soldByDefect.get(id) || 0));
        const unitPrice = Number(defect.unitPrice ?? defect.price ?? p.price ?? p.cost ?? 0);
        return { ...defect, quantity, total: quantity * unitPrice };
      }).filter((defect) => Number(defect.quantity) > 0);
      return {
        ...p,
        stock: Math.max(0, Number(p.stock) - (purchasedQty - borrowedQuantity)),
        defectiveStock: Math.max(0, Number(p.defectiveStock || 0) - defectiveQuantity),
        defects: updatedDefects,
      };
    });

    saveProducts(updatedProducts);
    setProductList(updatedProducts);
    if (activeReservationOrderId) {
      removeOrder(activeReservationOrderId);
      setActiveReservationOrderId(null);
    }
    setCompletedSale(sale);
    } catch {
      paymentSubmittingRef.current = false;
      setPaymentError("To'lovni saqlab bo'lmadi. Qayta urinib ko'ring.");
      return;
    }

    /* =================================================
       SHOW SUCCESS
    ================================================= */

    setPaidAmount(totalPaid);
    setPaymentComplete(true);
    setShowPaymentAnimation(true);
    if (paymentSoundRef.current) {
      paymentSoundRef.current.currentTime = 0;
      paymentSoundRef.current.play().catch(() => {});
    }
    setPaymentError("");
    clearTimeout(paymentTimerRef.current);
    paymentTimerRef.current = setTimeout(() => {
      setShowPaymentAnimation(false);
      setReceiptOpen(true);
    }, 2000);
  };

  /* =====================================================
     NEW SALE
  ===================================================== */

  const handleNewSale = () => {
    const closeFinishedSaleTab = !orderMode && Boolean(completedSale);
    setActiveReservationOrderId(null);
    setCompletedSale(null);
    clearTimeout(paymentTimerRef.current);
    if (paymentSoundRef.current) {
      paymentSoundRef.current.pause();
      paymentSoundRef.current.currentTime = 0;
    }
    paymentSubmittingRef.current = false;
    if (productsGridRef.current) productsGridRef.current.scrollTop = 0;
    setCart([]);

    setCustomerName("");
    setCustomerPhone("");
    setCustomerError("");
    setDeliveryAddress("");
    setDeliveryDate(todayForDateInput());
    setDeliveryDateSelected(false);
    setAddresses([]);
    setSelectedAddressId(null);
    setAddressConfirmed(false);
    setAddressError("");

    setGlobalDiscount(0);

    setReceiptOpen(false);

    setReceiptNumber("");
    setReceiptDate("");

    setPaymentOpen(false);
    setPaymentComplete(false);
    setShowPaymentAnimation(false);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setSelectedCardId("");
    setPaymentError("");
    setPaidAmount(0);
    if (orderMode) onOrderSaleComplete?.();
    else if (closeFinishedSaleTab) onSaleComplete?.();
  };

  /* =====================================================
     CART PROPS
  ===================================================== */

  const cartPanelProps = {
    cart,
    reservationMode: orderMode,
    allowReservationCheckout: orderMode,

    customerName,
    setCustomerName,
    customerSuggestions: readPosCustomerSuggestions(customerStorageKey, salesStorageKey, customerName, customerPhone),
    selectCustomer: (customer) => {
      setCustomerName(capitalizeCustomerName(customer.name));
      setCustomerPhone(phoneDigits(customer.phone));
      setCustomerError("");
    },

    customerPhone,
    setCustomerPhone,

    addresses,
    selectedAddressId,
    setSelectedAddressId,
    addDeliveryAddress,
    confirmDeliveryAddresses,
    moveItemToAddress,

    deliveryAddress,
    setDeliveryAddress,
    addressConfirmed,
    setAddressConfirmed,
    addressError,
    setAddressError,

    updateQty,
    setExactQty,
    removeItem,
    clearCart,

    globalDiscount,
    setGlobalDiscount,

    subtotal,
    discountAmt,
    total,

    handleCheckout,
    handleOpenReceipt,
    onSaveDraft: requestSaveSaleDraft,
    onReserveOrder: requestSaveOrder,

    customerError,
    paymentOpen,
    paymentAmount,
    previouslyPaidAmount,
    setPaymentAmount,
    paymentMethod,
    setPaymentMethod,
    selectedCardId,
    setSelectedCardId,
    debtDueDate,
    setDebtDueDate,
    deliveryDate,
    setDeliveryDate,
    setDeliveryDateSelected,
    paymentError,
    setPaymentError,
    paymentComplete,
    paidAmount,
    confirmPayment,
    closePayment,
  };

  /* =====================================================
     RETURN
  ===================================================== */

  return (
    <div ref={posContainerRef} className={`pos-container pos-split-layout${compactCart ? " pos-compact" : ""}`}>
      {quickAddProduct && (
        <ProductQuickAddModal
          product={{ ...quickAddProduct, stock: availableStock(quickAddProduct) }}
          allowBeyondStock={allowBorrow && !isDefectSale && !quickAddProduct.defectId}
          suppliers={suppliers}
          quantity={quickAddQuantity}
          onQuantityChange={setQuickAddQuantity}
          onAdd={confirmQuickAdd}
          defectRows={quickAddProduct.defectId ? null : defectSaleRows(quickAddProduct)}
          initialDefectId={quickAddInitialDefectId}
          onClose={closeQuickAdd}
        />
      )}

      {/* =================================================
          PRODUCTS SECTION
      ================================================= */}

      <div className="pos-products-section" inert={paymentOpen || (compactCart && cartWindowOpen)}>

        <div className="pos-header">
          <h1 className="pos-title">
            {saleSection ? tx(saleSection) : headingText ? tx(headingText) : tx(text(
              "title",
              orderMode ? "Yangi buyurtma" : "Yangi Sotuv"
            ))}
          </h1>

          <p className="pos-subtitle">
            {tx(text(
              "subtitle",
              orderMode ? "Mahsulotlarni tanlang, mijozni belgilang va buyurtmani band qiling" : "Mahsulot tanlang va savatchaga qo'shing"
            ))}
          </p>
          {addresses.length > 1 && selectedAddressId && (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "var(--brand)" }}>
              {tx("Mahsulotlar tanlangan manzil uchun qo'shiladi: ")}
              {tx(addresses.find((address) => address.id === selectedAddressId)?.name || "")}
            </div>
          )}
        </div>

        {/* SEARCH */}

        <div className="pos-search-wrapper">

          <div className="pos-search-box">
            <FiSearch
              size={18}
              className="pos-search-icon"
            />

            <input
              type="text"
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value.replace(/(^|\s)(\S)/g, (_, space, letter) => space + letter.toLocaleUpperCase("uz-UZ"))
                )
              }
              placeholder={tx("Mahsulot qidirish...")}
              className="pos-search-input"
              style={{
                outline: "none",
              }}
            />
          </div>

          <SalesProductFilter products={saleProducts} value={categoryFilter} onChange={setCategoryFilter} placeholder="Kategoriya..." />
        </div>

        {/* =================================================
            PRODUCTS
        ================================================= */}

        <div className="pos-products-grid" ref={productsGridRef} tabIndex={0} aria-label={tx("Mahsulotlar ro'yxati")}>

          {visibleProducts.length === 0 ? (
            <div className="pos-no-results">

              <FiSearch size={30} />

              <p>{tx(isDefectSale ? "Brak mahsulot topilmadi" : "Mahsulot topilmadi")}</p>

            </div>
          ) : (
            visibleProducts.map((p) => {

              const inCart =
                cart.find(
                  (c) =>
                    c.id === p.id && (isDefectSale ? c.defectId === p.defectId : !c.defectId)
                );

              const productAvailable = availableStock(p);
              const productId = String(p.id);
              const productReserved = isDefectSale
                ? reservedDefectQuantity(productId, p.defectId)
                : Number(reservedStock.good?.[productId] || 0) + Number(reservedStock.defective?.[productId] || 0);
              const isOutOfStock = productAvailable === 0;

              return (
                <div
                  key={isDefectSale ? `${p.id}-${p.defectId}` : p.id}
                  onClick={() => openQuickAdd(p)}
                  className={`product-card ${inCart
                    ? "in-cart"
                    : ""
                    } ${isOutOfStock
                      ? "out-of-stock"
                      : ""
                    }`}
                  role="button"
                  tabIndex={0}
                  aria-label={tx(`${p.name} tafsilotlarini ochish`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openQuickAdd(p);
                    }
                  }}
                >

                  <div className="product-card-body">

                    <div className="pos-product-head">
                      <div className="product-name">
                        <span className="pos-product-label">{tx("Nomi:")}</span> {p.name}
                      </div>
                      <div className="pos-product-stock-stack">
                        <span className={`pos-product-stock ${productAvailable < 5 ? "low-stock" : ""}`}>
                          {tx(isOutOfStock ? "Tugagan" : isDefectSale ? `Brak qoldig'i: ${productAvailable} dona` : `Qoldiq: ${productAvailable} dona`)}
                        </span>
                        {productReserved > 0 && <span className="pos-product-reserved">{tx("Band qilingan")}: {tx(productReserved)} {tx("dona")}</span>}
                      </div>
                    </div>

                    {isDefectSale ? <div className="product-category"><span className="pos-product-label">{tx("Brak holati:")}</span> {tx(p.defectStatus || "Brak")}</div> : <div className="product-category"><span className="pos-product-label">{tx("Kategoriya:")}</span> {p.category ? tx(p.category) : tx("Ko'rsatilmagan")}</div>}
                    <div className="pos-product-meta">{isDefectSale ? [p.defectReason && `${tx("Sabab:")} ${p.defectReason}`, p.brand && `${tx("Brend:")} ${p.brand}`, p.sku && `SKU: ${p.sku}`].filter(Boolean).join(" · ") : [p.brand && `${tx("Brend:")} ${p.brand}`, p.sku && `SKU: ${p.sku}`].filter(Boolean).join(" · ")}</div>

                    <div className="product-footer">

                      <span className="product-price"><span className="pos-product-label">{tx(isDefectSale ? "Brak narxi:" : "Narxi:")}</span> {formatCurrency(isDefectSale ? p.defectPrice : p.price)}</span>

                    </div>

                    <button
                      type="button"
                      className="pos-product-add-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        openQuickAdd(p);
                      }}
                    >
                      <FiShoppingCart size={17} />{tx(isDefectSale ? "Brakni savatga qo'shish" : "Savatga qo'shish")}</button>

                  </div>

                </div>
              );
            })
          )}

        </div>

      </div>

      <button
        ref={cartToggleRef}
        type="button"
        className="pos-cart-launcher"
        onClick={() => onCartWindowChange?.(true)}
        aria-expanded={cartWindowOpen}
        aria-controls="pos-cart-window"
        inert={compactCart && cartWindowOpen}
      >
        <FiShoppingCart size={22} />
        <span>{tx("Savatcha ")}<small>({tx(cartProductCount)})</small></span>
        <strong>{formatCurrency(total)}</strong>
      </button>

      <div
        id="pos-cart-window"
        className={"pos-cart-window" + (cartWindowOpen ? " is-open" : "") + (paymentOpen ? " is-paying" : "")}
        role={compactCart ? "region" : undefined}
        aria-label={tx(compactCart ? "Savatcha va buyurtma" : undefined)}
      >
        <div className="pos-cart-window-body" ref={cartWindowBodyRef}>
          <CartPanelContent {...cartPanelProps} hideSaveDraftButton={hideSaveDraftButton} />
        </div>
      </div>

      {/* =================================================
          ADD / EDIT PRODUCT MODAL
      ================================================= */}

      {isModalOpen && (
        createPortal(
        <div className="crm-content-modal pos-container">

          <div
            className="pos-modal-content"
            style={{
              borderRadius: "16px",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            }}
          >

            <h2 className="pos-modal-title">

              {tx(editingProduct
                ? "Mahsulotni tahrirlash"
                : "Yangi mahsulot qo'shish")}

            </h2>

            <form
              onSubmit={
                handleSaveProduct
              }
              className="pos-modal-form"
            >

              <div className="form-group">

                <label>{tx("Nomi")}</label>

                <input
                  type="text"
                  required
                  value={
                    formData.name
                  }
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      name: e.target
                        .value,
                    })
                  }
                  placeholder={tx("Mahsulot nomi")}
                  className="modal-input"
                  style={{
                    outline: "none",
                  }}
                />

              </div>

              <div className="form-group">

                <label>{tx("Narxi (so'm)")}</label>

                <input
                  type="number"
                  required
                  min="0"
                  value={moneyInputValue(formData.price, false)}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      price: String(toBaseMoney(e.target.value)),
                    })
                  }
                  placeholder={tx("10000")}
                  className="modal-input"
                  style={{
                    outline: "none",
                  }}
                />

              </div>

              <div className="form-group">

                <label>{tx("Soni (dona)")}</label>

                <input
                  type="number"
                  required
                  min="0"
                  value={
                    formData.stock
                  }
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      stock: e.target
                        .value,
                    })
                  }
                  placeholder={tx("10")}
                  className="modal-input"
                  style={{
                    outline: "none",
                  }}
                />

              </div>

              <div className="modal-buttons">

                <button
                  type="button"
                  onClick={
                    closeProductModal
                  }
                  className="modal-btn cancel"
                >{tx("Bekor qilish")}</button>

                <button
                  type="submit"
                  className="modal-btn save"
                >{tx("Saqlash")}</button>

              </div>

            </form>

          </div>

        </div>,
        document.getElementById("main-modal-root")
      )
      )}

      {/* =================================================
          DELETE MODAL
      ================================================= */}

      {deleteModalOpen && (
        createPortal(
        <div className="crm-content-modal pos-container">

          <div
            className="pos-modal-content delete-confirm-box"
            style={{
              borderRadius: "16px",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >

            <div className="pos-delete-icon-wrap">
              <FiAlertTriangle
                size={32}
              />
            </div>

            <h2>{tx("O'chirishni tasdiqlang")}</h2>

            <p>{tx("Haqiqatan ham ushbu mahsulotni o'chirmoqchimisiz?")}</p>

            <div className="modal-buttons delete-modal-btns">

              <button
                type="button"
                onClick={
                  cancelDeleteProduct
                }
                className="modal-btn cancel"
              >{tx("Yo'q")}</button>

              <button
                type="button"
                onClick={
                  confirmDeleteProduct
                }
                className="modal-btn delete-confirm"
              >{tx("Ha, o'chirish")}</button>

            </div>

          </div>

        </div>,
        document.getElementById("main-modal-root")
      )
      )}

      {/* =================================================
          RECEIPT MODAL
      ================================================= */}

      {receiptOpen && createPortal(
        <div
          className="receipt-modal-overlay"
          id="receipt-modal"
        >

          <div className="receipt-modal">

            {/* HEADER */}

            <div className="receipt-modal-header">

              <div>
                <h2>{tx("Chek")}</h2>

                <span>{tx("Sotuv cheki")}</span>
              </div>

              <button
                type="button"
                onClick={
                  handleCloseReceipt
                }
                className="receipt-close-btn"
              >
                <FiX size={20} />
              </button>

            </div>

            {/* =================================================
                PRINT PAPER
            ================================================= */}

            <div
              className="receipt-paper"
              id="receipt-print"
            >

              <div className="receipt-shop-header">

                <h1>{companyName}</h1>

                <p>{tx("Sotuv cheki")}</p>

                <div className="receipt-line" />

              </div>

              {/* DATE */}

              <div className="receipt-meta">

                <div>
                  <span>{tx("Chek raqami")}</span>

                  <strong>
                    {completedSale?.receiptNumber || receiptNumber}
                  </strong>
                </div>

                <div>
                  <span>{tx("Sana")}</span>

                  <strong>
                    {tx(completedSale?.formattedDate || receiptDate)}
                  </strong>
                </div>

              </div>

              {/* CUSTOMER */}

              <div className="receipt-customer">

                <div className="receipt-section-title">
                  <FiUser size={15} />
                  <span>{tx("Mijoz")}</span>
                </div>

                <div className="receipt-customer-row">

                  <span>{tx("Ism:")}</span>

                  <strong>
                    {completedSale?.customerName || customerName || tx("Ko'rsatilmagan")}
                  </strong>

                </div>

                <div className="receipt-customer-row">

                  <span>{tx("Telefon:")}</span>

                  <strong>
                    {tx(completedSale?.customerPhone || (customerPhone ? `+998 ${formatUzPhone(customerPhone)}` : "Ko'rsatilmagan"))}
                  </strong>

                </div>

                {receiptAddressRows.map(({ address, deliveryDate }, index) => (
                  <div className="receipt-customer-row receipt-address-row" key={`${index}-${address}`}>
                    <span>{tx("Yetkazish manzili")}{receiptAddressRows.length > 1 ? ` ${index + 1}` : ""}:</span>
                    <strong>{address}{deliveryDate ? <small style={{ display: "block", fontWeight: 500 }}>{tx("Yetkazib berish sanasi")}: {deliveryDate.split("-").reverse().join(".")}</small> : null}</strong>
                  </div>
                ))}
              </div>

              <div className="receipt-line" />

              {/* PRODUCTS */}

              <div className="receipt-products">

                <div className="receipt-products-title">{tx("Mahsulotlar")}</div>

                {(completedSale?.items || cart).map(
                  (item, index) => (
                    <div
                      key={item.cartKey || `${item.id}:${index}`}
                      className="receipt-product"
                    >

                      <div className="receipt-product-top">

                        <span className="receipt-product-number">
                          {tx(index + 1)}.
                        </span>

                        <strong>
                          {item.name}
                        </strong>

                      </div>

                      <div className="receipt-product-bottom">

                        {item.isDefectSale && <span style={{ color: "var(--danger)" }}>{tx("Brak")}{item.defectStatus ? ` · ${tx(item.defectStatus)}` : ""}{item.defectReason ? ` · ${tx(item.defectReason)}` : ""}</span>}

                        <span>
                          {tx(item.qty)}{tx(" dona ?")}{" "}
                          {formatCurrency(item.price)}</span>

                        <strong>
                          {formatCurrency((
                            Number(
                              item.price
                            ) *
                            Number(
                              item.qty
                            )
                          ))}</strong>

                      </div>

                    </div>
                  )
                )}

              </div>

              <div className="receipt-line" />

              {/* TOTALS */}

              <div className="receipt-summary">

                <div className="receipt-summary-row">

                  <span>{tx("Mahsulotlar jami")}</span>

                  <strong>
                    {formatCurrency(completedSale?.subtotal ?? subtotal)}</strong>

                </div>

                {(completedSale?.discountPercent ?? globalDiscount) > 0 && (
                  <div className="receipt-summary-row discount">

                    <span>{tx("Chegirma")}{" "}
                      ({tx(completedSale?.discountPercent ?? globalDiscount)}%)
                    </span>

                    <strong>
                      -{formatCurrency(completedSale?.discountAmount ?? discountAmt)}</strong>

                  </div>
                )}

                <div className="receipt-total-row">

                  <span>{tx("JAMI TO'LOV")}</span>

                  <strong>
                    {formatCurrency(completedSale?.total ?? total)}</strong>

                </div>

              </div>

              <div className="receipt-line" />

              <ReceiptPaymentDetails sale={completedSale} />

              {/* FOOTER */}

              <div className="receipt-footer">

                <p>{tx("Xaridingiz uchun rahmat!")}</p>

                <span>{companyName}</span>

              </div>

            </div>

            {/* =================================================
                RECEIPT BUTTONS
            ================================================= */}

            <div className="receipt-modal-actions">

              <button
                type="button"
                onClick={
                  handleCloseReceipt
                }
                className="receipt-action-close"
              >{tx("Yopish")}</button>

              <button
                type="button"
                onClick={
                  handlePrintReceipt
                }
                className="receipt-action-print"
              >
                <FiPrinter
                  size={17}
                />{tx("Chekni chiqarish")}</button>

            </div>

          </div>

        </div>,

        document.getElementById("main-modal-root") || document.body
      )}

      {showPaymentAnimation && createPortal(
        <PaymentSuccessAnimation
          amount={paidAmount}
          remainingDebt={Math.max(0, Math.round(total) - paidAmount)}
        />,
        document.getElementById("main-modal-root") || document.body
      )}

      <Modal contentOnly open={reserveConfirmOpen} onClose={() => setReserveConfirmOpen(false)} title="Band qilishni tasdiqlang" subtitle="Mahsulotlar buyurtma uchun band qilinadi" icon={FiBookmark} width={480}>
        <div className="pos-save-draft-summary">
          <div><span>{tx("Mijoz")}</span><strong>{customerName.trim() || "Ism kiritilmagan"}</strong></div>
          <div><span>{tx("Telefon")}</span><strong>{customerPhone ? `+998 ${formatUzPhone(customerPhone)}` : "Kiritilmagan"}</strong></div>
          <div><span>{tx("Savdo ochilgan vaqt")}</span><strong>{new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(draftOpenedAt || Date.now()))}</strong></div>
          <div><span>{tx("Mahsulotlar")}</span><strong>{cartProductCount}{tx("xil ·")}{cart.reduce((sum, item) => sum + Number(item.qty || 0), 0)}{tx("dona")}</strong></div>
          <div className="pos-save-draft-total"><span>{tx("Jami")}</span><strong>{formatCurrency(total)}</strong></div>
          <label className="pos-reservation-advance"><span>{tx("Oldindan to‘lov summasi")} · {tx("ixtiyoriy")}</span><div><input className="input-base" type="text" inputMode="numeric" value={advancePayment === "" ? "" : moneyInputValue(advancePayment, true)} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ""); const amount = digits ? toBaseMoney(digits) : ""; setAdvancePayment(amount === "" ? "" : String(Math.min(Math.round(total), amount))); }} placeholder="0" /><em>{tx("so‘m")}</em></div></label>
          {toBaseMoney(advancePayment) > 0 && <>
            <div className="pos-reservation-payment-preview"><span>{tx("Qabul qilinadigan oldindan to‘lov")}</span><strong>{formatCurrency(Math.min(Math.round(total), toBaseMoney(advancePayment)))}</strong></div>
            <fieldset className="pos-reservation-method"><legend>{tx("To‘lov usuli")}</legend><div>
              <button type="button" className={advancePaymentMethod === "cash" ? "is-active" : ""} aria-pressed={advancePaymentMethod === "cash"} onClick={() => setAdvancePaymentMethod("cash")}>{tx("Naqd")}</button>
              <button type="button" className={advancePaymentMethod === "card" ? "is-active" : ""} aria-pressed={advancePaymentMethod === "card"} onClick={() => setAdvancePaymentMethod("card")}>{tx("Karta")}</button>
            </div></fieldset>
            {advancePaymentMethod === "card" && <ReceivingCardSelect value={selectedAdvanceCardId} onChange={setSelectedAdvanceCardId} />}
          </>}
        </div>
        <div className="pos-save-draft-actions">
          <button type="button" onClick={() => setReserveConfirmOpen(false)}>{tx("Bekor qilish")}</button>
          <button type="button" onClick={() => { setReserveConfirmOpen(false); requestSaveOrder(true); }}>{tx("Band qilishni tasdiqlash")}</button>
        </div>
      </Modal>

      <Modal contentOnly open={saveDraftOpen} onClose={() => setSaveDraftOpen(false)} title="Sotuvni saqlashni tasdiqlang" subtitle="Savat keyin davom ettirish uchun Qoralamaga saqlanadi" icon={FiShoppingCart} width={480}>
        <div className="pos-save-draft-summary">
          <div><span>{tx("Mijoz")}</span><strong>{customerName.trim() || "Ism kiritilmagan"}</strong></div>
          <div><span>{tx("Telefon")}</span><strong>{customerPhone ? `+998 ${formatUzPhone(customerPhone)}` : "Kiritilmagan"}</strong></div>
          <div><span>{tx("Savdo ochilgan vaqt")}</span><strong>{new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(draftOpenedAt || Date.now()))}</strong></div>
          <div><span>{tx("Mahsulotlar")}</span><strong>{cartProductCount}{tx("xil ·")}{cart.reduce((sum, item) => sum + Number(item.qty || 0), 0)}{tx("dona")}</strong></div>
          <div className="pos-save-draft-total"><span>{tx("Jami")}</span><strong>{formatCurrency(total)}</strong></div>
        </div>
        <div className="pos-save-draft-actions">
          <button type="button" onClick={() => setSaveDraftOpen(false)}>{tx("Bekor qilish")}</button>
          <button type="button" onClick={confirmSaveSaleDraft}>{tx("Ha, saqlash")}</button>
        </div>
      </Modal>

    </div>
  );
}
