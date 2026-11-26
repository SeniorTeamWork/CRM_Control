// Brauzer kodini foydalanuvchidan yashirmaydi; faqat keng tarqalgan inspeksiya
// tugmalari va kontekst menyusini tasodifan ochilishidan to'sadi.
export function installInspectionDeterrent() {
  const preventContextMenu = (event) => event.preventDefault();
  const preventInspectionShortcuts = (event) => {
    const key = String(event.key || "").toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    const opensDevTools =
      key === "f12" ||
      (modifier && event.shiftKey && ["i", "j", "c"].includes(key)) ||
      (modifier && key === "u") ||
      (key === "f10" && event.shiftKey) ||
      key === "contextmenu";

    if (!opensDevTools) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  document.addEventListener("contextmenu", preventContextMenu);
  window.addEventListener("keydown", preventInspectionShortcuts, true);

  return () => {
    document.removeEventListener("contextmenu", preventContextMenu);
    window.removeEventListener("keydown", preventInspectionShortcuts, true);
  };
}
