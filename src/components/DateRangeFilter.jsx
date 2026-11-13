import { translateText as tx } from "../locales/translateText";

export const matchesDateRange = (value, from, to) => {
  if (!from && !to) return true;
  const text = String(value || "");
  const day = /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : (() => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  })();
  return !!day && (!from || day >= from) && (!to || day <= to);
};

export default function DateRangeFilter({ from, to, onFromChange, onToChange, applyOnEnter = false }) {
  const applyDate = (event, onChange) => {
    if (!applyOnEnter || event.key !== "Enter" || !event.currentTarget.validity.valid) return;
    event.preventDefault();
    onChange(event.currentTarget.value);
    event.currentTarget.blur();
  };
  return <div className="flex items-center gap-2 flex-wrap">
    <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>{tx("Dan")}<input aria-label={tx("Boshlanish sanasi")} type="date" className="input-base" value={from} onKeyDown={(event) => applyDate(event, onFromChange)} onChange={(e) => onFromChange(e.target.value)} style={{ width: 145 }} /></label>
    <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>{tx("Gacha")}<input aria-label={tx("Tugash sanasi")} type="date" className="input-base" value={to} onKeyDown={(event) => applyDate(event, onToChange)} min={from || undefined} onChange={(e) => onToChange(e.target.value)} style={{ width: 145 }} /></label>
  </div>;
}
