import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import './Topbar.css';
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Search,
  Plus,
  X,
  Package,
  Users,
  ShoppingCart,
  Building2,
  Zap,
  Sun,
  Moon,
  LayoutDashboard,
  FileText,
  CalendarClock,
  RotateCcw,
  PackageX,
  UserRound,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useLanguage, languages } from "../context/LanguageContext";
import { profileInitials, profileName } from "../data/profileStore";
import { createPortal } from "react-dom";
import { getCurrencySettings, saveCurrencySettings } from "../data/currency";

import { formatCurrency } from "../data/currency";
import { getProducts } from "../supabase/bolimlar/mahsulotlar";
import { getCustomers } from "../supabase/bolimlar/mijozlar";
import Modal from "./Modal";
import { buildNavItems } from "./Sidebar";
import { canAccess } from "../data/accessStore";

const COMPACT_QUERY = "(max-width: 700px)";
// Kurs oynasi animatsiyasi (2 soniyadan ancha qisqa).
const RATE_OPEN_MS = 460;
const RATE_CLOSE_MS = 360;
const matchesQuery = (query) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

// Oyna bosilgan tugma joyidan kichik holda chiqib, ekran markazida to'liq o'lchamga yetadi.
function morphFrames(card, origin) {
  if (!card || typeof card.animate !== "function" || matchesQuery("(prefers-reduced-motion: reduce)")) return null;
  const box = card.getBoundingClientRect();
  const from = origin?.isConnected ? origin.getBoundingClientRect() : { left: box.left + box.width / 2, top: box.top, width: 0, height: 0 };
  const dx = from.left + from.width / 2 - (box.left + box.width / 2);
  const dy = from.top + from.height / 2 - (box.top + box.height / 2);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0, borderRadius: "40px" },
    { transform: "translate(0, 0) scale(1)", opacity: 1, borderRadius: "18px" },
  ];
}

export default function Topbar({ onNavigate, onSelectSaleSection, onOpen, user, profile }) {
  useUILanguage();
  const { dark, toggle } = useTheme();
  const { lang, setLang, t } = useLanguage();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState(getCurrencySettings);
  const [rateDraft, setRateDraft] = useState(() => String(getCurrencySettings().usdRate || ""));
  const [rateModal, setRateModal] = useState(false);
  const [saleSectionsOpen, setSaleSectionsOpen] = useState(false);

  const [customSections, setCustomSections] = useState([]);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [newSectionPage, setNewSectionPage] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const updateCurrency = () => setCurrency(getCurrencySettings());
    window.addEventListener("crm-currency-change", updateCurrency);
    return () => window.removeEventListener("crm-currency-change", updateCurrency);
  }, []);

  // Telefonda (≤700px) "1$" tugmasi yashirin: USD bosilganda har safar kurs oynasi ochiladi.
  const [compactCurrency, setCompactCurrency] = useState(() => matchesQuery(COMPACT_QUERY));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompactCurrency(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  // Kurs oynasi bosilgan tugmadan o'sib chiqadi va yopilganda o'sha tugmaga qaytadi.
  const rateOriginRef = useRef(null);
  const rateCardRef = useRef(null);
  const rateBackdropRef = useRef(null);
  const rateClosingRef = useRef(false);
  useLayoutEffect(() => {
    if (!rateModal) return;
    rateClosingRef.current = false;
    const frames = morphFrames(rateCardRef.current, rateOriginRef.current);
    rateBackdropRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: frames ? RATE_OPEN_MS * 0.7 : 150, easing: "ease-out" });
    if (frames) rateCardRef.current.animate(frames, { duration: RATE_OPEN_MS, easing: "cubic-bezier(.2, .9, .25, 1.05)" });
  }, [rateModal]);
  const openRateEditor = (event) => {
    rateOriginRef.current = event?.currentTarget || null;
    setRateDraft(String(currency.usdRate || ""));
    setRateModal(true);
  };
  const closeRateEditor = () => {
    if (!rateModal || rateClosingRef.current) return;
    rateClosingRef.current = true;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; rateClosingRef.current = false; setRateModal(false); };
    const frames = morphFrames(rateCardRef.current, rateOriginRef.current);
    if (!frames) { finish(); return; }
    const animation = rateCardRef.current.animate([...frames].reverse(), { duration: RATE_CLOSE_MS, easing: "cubic-bezier(.55, 0, .75, .2)", fill: "forwards" });
    rateBackdropRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: RATE_CLOSE_MS, easing: "ease-in", fill: "forwards" });
    animation.onfinish = finish;
    animation.oncancel = finish;
    // Tab fonda bo'lsa brauzer animatsiyani to'xtatib turadi: oyna baribir yopilsin.
    window.setTimeout(finish, RATE_CLOSE_MS + 150);
  };
  useEffect(() => {
    if (!rateModal) return undefined;
    const onKey = (event) => { if (event.key === "Escape") closeRateEditor(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const saveRate = (event) => {
    event.preventDefault();
    const usdRate = Number(String(rateDraft).replace(/,/g, ""));
    if (!Number.isFinite(usdRate) || usdRate <= 0) return;
    setCurrency(saveCurrencySettings({ code: "USD", usdRate }));
    closeRateEditor();
  };

  const changeCurrency = (code, event) => {
    if (code === "USD" && (compactCurrency || !currency.usdRate)) { openRateEditor(event); return; }
    setCurrency(saveCurrencySettings({ ...currency, code }));
  };

  const q = query.toLowerCase();
  const savedProducts = (() => {
    try { return getProducts(); } catch { return []; }
  })();
  const savedCustomers = (() => {
    try { return getCustomers(); } catch { return []; }
  })();
  const filteredProducts =
    q.length > 1
      ? savedProducts
          .filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.sku.toLowerCase().includes(q),
          )
          .slice(0, 3)
      : [];
  const filteredCustomers =
    q.length > 1
      ? savedCustomers
          .filter(
            (c) => c.name.toLowerCase().includes(q) || c.phone.includes(query),
          )
          .slice(0, 3)
      : [];
  const showEmpty =
    q.length > 1 && !filteredProducts.length && !filteredCustomers.length;
  const menuPages = new Set(["sales-new", "sales-pos", "drafts", "orders", "customers", "sales-returns", "defective-products", "pending-pickups", ...customSections]);
  const accessiblePages = buildNavItems(t).flatMap((item) => item.children || [item])
    .filter((item) => item.id && canAccess(user, item.id));
  const availablePages = accessiblePages.filter((item) => !menuPages.has(item.id));
  const saleSections = [
    { label: "Qoralama", icon: FileText, color: "#8b5cf6", bg: "rgba(139,92,246,.10)" },
    { label: "Band qilingan", icon: CalendarClock, color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
    { label: "Mijoz bor", icon: UserRound, color: "#2563eb", bg: "rgba(37,99,235,.10)" },
    { label: "Qaytmalar", icon: RotateCcw, color: "#0f9f82", bg: "rgba(15,159,130,.10)" },
    { label: "Brak", icon: PackageX, color: "#e45555", bg: "rgba(228,85,85,.10)" },
    { label: "Yetkazib berish", icon: CalendarClock, color: "#d28b16", bg: "rgba(210,139,22,.12)" },
    ...accessiblePages.filter((item) => customSections.includes(item.id)).map((item) => ({ ...item, color: "#64748b", bg: "rgba(100,116,139,.10)" })),
  ];
  const openSaleSection = (label, pageId) => {
    const targetPage = pageId || (label === "Yetkazib berish" ? "pending-pickups" : "");
    onSelectSaleSection?.(targetPage ? "page:" + targetPage : label);
    setSaleSectionsOpen(false);
    setAddSectionOpen(false);
  };
  const addSaleSection = (event) => {
    event.preventDefault();
    const page = availablePages.find((item) => item.id === newSectionPage);
    if (!page) return;
    setCustomSections((current) => current.includes(page.id) ? current : [...current, page.id]);
    setNewSectionPage("");
    setAddSectionOpen(false);
  };
  const quickActions = [
    {
      icon: ShoppingCart,
      label: t("topbar.newSale", "Yangi sotuv"),
      page: "sales-new",
    },
    {
      icon: Package,
      label: t("topbar.addProduct", "Mahsulot qo'shish"),
      page: "products-all",
    },
    {
      icon: Users,
      label: t("topbar.addCustomer", "Mijoz qo'shish"),
      page: "customers-all",
    },
    {
      icon: Building2,
      label: t("topbar.stockIn", "Omborga kirim"),
      page: "inventory",
    },
    {
      icon: Zap,
      label: t("topbar.dashboard", "Dashboard"),
      page: "dashboard",
    },
  ];

  return (
    <>
      <header
        className="crm-topbar topbar-container flex items-center justify-between h-16 px-3 sm:px-6 gap-2 sm:gap-3 shrink-0 w-full"
        style={{
          background: "var(--topbar-bg)",
          borderBottom: "1px solid var(--border)",
          zIndex: 10,
          position: "relative",
        }}
      >
        {/* Chap tomon: Dashboard iconi va Qidirish inputi */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 max-w-xl">
          {/* Dashboard ikonchasi har doim ko'rinadi va kichik ekranda ham o'lchami moslashadi */}
          <button
            onClick={() => onNavigate("dashboard")}
            className="p-2 sm:p-2.5 rounded-xl transition-all hover:opacity-80 shrink-0 flex items-center justify-center"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--brand)",
            }}
            title={tx(t("topbar.dashboard", "Dashboard"))}
          >
            <LayoutDashboard size={18} />
          </button>

          {/* Search pill (Input) */}
          <button
            onClick={() => {
              setSearchOpen(true);
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
            className="search-pill flex items-center gap-2 rounded-xl px-2.5 sm:px-3 py-2 text-xs sm:text-sm transition-all hover:opacity-90 flex-1"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-faint)",
            }}
          >
            <Search size={15} className="shrink-0" style={{ color: "var(--text-primary)" }} />
            <span className="flex-1 text-left truncate hidden sm:inline">
              {tx(t("topbar.searchPlaceholder", "Mahsulot, mijoz yoki sotuv qidirish..."))}
            </span>
            <span className="flex-1 text-left truncate sm:hidden">
              {tx(t("topbar.searchShort", "Qidirish..."))}
            </span>
            <kbd
              className="hidden md:inline-block text-xs px-1.5 py-0.5 rounded font-mono"
              style={{
                background: "var(--border)",
                color: "var(--text-faint)",
                fontSize: 10,
              }}
            >{tx("⌘K")}</kbd>
          </button>
        </div>

        {/* O'ng tomon: Til almashtirish, Dark mode, Yangi sotuv va Profil */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {currency.enabled.length > 1 && <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }} title={currency.usdRate ? `1 USD = ${currency.usdRate.toLocaleString("en-US")} UZS` : tx("Dollar kursini kiriting")}>
            {currency.enabled.map((code) => <button key={code} type="button" onClick={(event) => changeCurrency(code, event)} aria-label={code === "USD" && compactCurrency ? tx("Dollar kursini kiritish va USD tanlash") : undefined} className="lang-switch-btn" style={{ padding: "5px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: 0, background: currency.code === code ? "var(--brand)" : "transparent", color: currency.code === code ? "#fff" : "var(--text-muted)" }}>{code}</button>)}
            {currency.enabled.includes("USD") && <button type="button" className="currency-rate-btn" onClick={openRateEditor} aria-label={tx("Dollar kursini sozlash")} title={tx("Dollar kursini sozlash")} style={{ border: 0, borderLeft: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 10, padding: "4px 6px" }}>1$</button>}
          </div>}
          {/* Til almashtirish tugmasi (UZ / RU) */}
          <div
            className="lang-switch flex items-center shrink-0"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 2,
            }}
            title={tx(t("topbar.language", "Til"))}
          >
            {languages.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className="lang-switch-btn"
                style={{
                  padding: "5px 8px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  border: "none",
                  cursor: "pointer",
                  transition: "all .15s ease",
                  background: lang === l.code ? "var(--brand)" : "transparent",
                  color: lang === l.code ? "#fff" : "var(--text-muted)",
                }}
                title={l.name}
              >
                {tx(l.label)}
              </button>
            ))}
          </div>

          <button
            onClick={toggle}
            className="p-2 sm:p-2.5 rounded-xl transition-all hover:opacity-80 shrink-0"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
            title={tx(dark ? t("topbar.lightMode", "Yorug' rejim") : t("topbar.darkMode", "Qorong'u rejim"))}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <button
            type="button"
            onClick={() => { setSaleSectionsOpen(true); setAddSectionOpen(false); }}
            aria-label={tx(t("topbar.newSale", "Yangi sotuv"))}
            title={tx(t("topbar.newSale", "Yangi sotuv"))}
            className="quick-sale-btn flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-90 active:scale-95 shrink-0"
            style={{
              background: "rgba(139,92,246,.10)",
              border: "1px solid rgba(139,92,246,.10)",
              color: "#8b5cf6",
            }}
          >
            <FileText size={18} strokeWidth={2} aria-hidden="true" />
          </button>

          <div
            onClick={() => onNavigate("settings")}
            className="flex items-center gap-2 cursor-pointer group transition-all hover:opacity-80 active:scale-95 shrink-0 ml-1"
            title={tx(t("topbar.settings", "Sozlamalarga o'tish"))}
          >
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{
                background: "linear-gradient(135deg,var(--brand),var(--violet))",
              }}
            >
              {profileInitials(profile, user)}
            </div>
            <div className="hidden lg:block">
              <div
                className="text-sm font-semibold leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {profileName(profile, user)}
              </div>
              <div
                className="text-xs"
                style={{ color: "var(--text-faint)" }}
              >
                {tx(profile?.position || (user?.type === "director" ? "Direktor" : user?.role || "Xodim"))}
              </div>
            </div>
          </div>
        </div>
      </header>

      <Modal
        open={saleSectionsOpen}
        onClose={() => { setSaleSectionsOpen(false); setAddSectionOpen(false); }}
        title="Sotuv bo‘limini tanlang"
        subtitle="Yangi sotuvni qaysi bo‘limda boshlaysiz?"
        icon={ShoppingCart}
        width={620}
        contentOnly
      >
        <div className="sale-section-modal">
          <div className="sale-section-grid">
            {saleSections.map(({ id, label, icon: SectionIcon, color, bg }) => (
              <button
                type="button"
                key={id || label}
                className="sale-section-option"
                onClick={() => openSaleSection(label, id)}
              >
                <span className="sale-section-icon" style={{ color, background: bg }}><SectionIcon size={19} /></span>
                <span className="sale-section-label">{tx(label)}</span>
                <span className="sale-section-arrow" aria-hidden="true">›</span>
              </button>
            ))}
            <button type="button" className="sale-section-option sale-section-add" onClick={() => setAddSectionOpen((open) => !open)}>
              <span className="sale-section-icon"><Plus size={19} /></span>
              <span className="sale-section-label">{tx("Bo‘lim qo‘shish")}</span>
              <span className="sale-section-arrow" aria-hidden="true">+</span>
            </button>
          </div>
          {addSectionOpen && (
            <form className="sale-section-add-form" onSubmit={addSaleSection}>
              <select autoFocus value={newSectionPage} onChange={(event) => setNewSectionPage(event.target.value)} aria-label={tx("Sahifani tanlang")}>
                <option value="">{tx(availablePages.length ? "Sahifani tanlang" : "Qo‘shish uchun sahifa qolmadi")}</option>
                {availablePages.map((item) => <option key={item.id} value={item.id}>{tx(item.label)}</option>)}
              </select>
              <button type="submit" disabled={!newSectionPage.trim()}>{tx("Qo‘shish")}</button>
            </form>
          )}

        </div>
      </Modal>

      {rateModal && createPortal(<div ref={rateBackdropRef} data-motion="manual" className={`crm-content-modal currency-rate-modal${compactCurrency ? " is-screen" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeRateEditor(); }}>
        <form ref={rateCardRef} role="dialog" aria-modal="true" aria-labelledby="currency-rate-title" onSubmit={saveRate} className="currency-rate-card" style={{ width: "min(100%, 420px)", padding: 24, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
          <div className="flex items-start justify-between gap-3 mb-5"><div><h2 id="currency-rate-title" className="font-display font-bold text-lg">{tx("Dollar kursi")}</h2><p className="text-xs mt-1 text-muted-color">{tx("1 USD necha so'm ekanini kiriting. Barcha narxlar shu kursda ko'rsatiladi.")}</p></div><button type="button" onClick={closeRateEditor} aria-label={tx("Yopish")}><X size={18}/></button></div>
          <label className="block text-sm font-semibold">{tx("1 USD = UZS")}<input className="input-base mt-1.5" type="number" inputMode="decimal" min="1" step="any" required autoFocus value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} placeholder="Masalan: 12 500" /></label>
          <div className="flex justify-end gap-2 mt-5"><button type="button" className="btn-ghost" onClick={closeRateEditor}>{tx("Bekor qilish")}</button><button type="submit" className="btn-primary">{tx("Saqlash va USD tanlash")}</button></div>
        </form>
      </div>, (compactCurrency ? document.body : document.getElementById("main-modal-root")) || document.body)}

      {/* Command Palette */}
      {searchOpen && (
        <div
          className="command-palette-overlay motion-overlay fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4"
          style={{
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
          }}
          onClick={() => {
            setSearchOpen(false);
            setQuery("");
          }}
        >
          <div
            className="w-full max-w-xl rounded-2xl overflow-hidden motion-drop"
            style={{
              background: "var(--surface)",
              boxShadow: "var(--shadow-lg)",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-3 px-5 py-4"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <Search size={18} style={{ color: "var(--text-faint)" }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tx(t("topbar.searchPlaceholder", "Mahsulot, mijoz yoki sotuv qidirish..."))}
                className="flex-1 text-base outline-none bg-transparent"
                style={{ color: "var(--text-primary)" }}
              />
              {query && (
                <button onClick={() => setQuery("")}>
                  <X size={15} style={{ color: "var(--text-faint)" }} />
                </button>
              )}
              <kbd
                className="text-xs px-1.5 py-0.5 rounded font-mono"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-faint)",
                  border: "1px solid var(--border)",
                }}
              >{tx("Esc")}</kbd>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {!query && (
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-faint)" }}>
                    {tx(t("topbar.quickActions", "TEZKOR AMALLAR"))}
                  </p>
                  {quickActions.map((a) => (
                    <button
                      key={a.page}
                      onClick={() => {
                        onNavigate(a.page);
                        setSearchOpen(false);
                        setQuery("");
                      }}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all text-left"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-light)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <a.icon size={15} style={{ color: "var(--text-muted)" }} />
                      {tx(a.label)}
                    </button>
                  ))}
                </div>
              )}

              {filteredProducts.length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-faint)" }}>
                    {tx(t("topbar.products", "MAHSULOTLAR"))}
                  </p>
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onNavigate("product-" + p.id);
                        setSearchOpen(false);
                        setQuery("");
                      }}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all text-left"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-light)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span className="text-xl">{tx(p.image)}</span>
                      <div className="flex-1">
                        <div className="font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</div>
                        <div className="text-xs" style={{ color: "var(--text-faint)" }}>{p.sku} · {tx(p.category)}</div>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: "var(--brand)" }}>
                        {formatCurrency(p.price)}</span>
                    </button>
                  ))}
                </div>
              )}

              {filteredCustomers.length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-faint)" }}>
                    {tx(t("topbar.customers", "MIJOZLAR"))}
                  </p>
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        onNavigate("customer-" + c.id);
                        setSearchOpen(false);
                        setQuery("");
                      }}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all text-left"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-light)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: "var(--brand)" }}
                      >
                        {tx(c.name.split(" ").map((n) => n[0]).join("").slice(0, 2))}
                      </div>
                      <div>
                        <div className="font-medium" style={{ color: "var(--text-primary)" }}>{c.name}</div>
                        <div className="text-xs" style={{ color: "var(--text-faint)" }}>{c.phone}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {showEmpty && (
                <div className="py-10 text-center">
                  <p className="text-sm" style={{ color: "var(--text-faint)" }}>
                    "{tx(query)}" {tx(t("topbar.notFound", "uchun hech narsa topilmadi"))}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
