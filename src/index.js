import React from "react";
import ReactDOM from "react-dom/client";
import { installExitAnimations } from "./utils/motion";
import { installInspectionDeterrent } from "./utils/inspectionDeterrent";
import { startSupabase } from "./supabase/db";

// Bu faqat oddiy inspeksiya tugmalarini to'sadi; client kodini maxfiy qilmaydi.
installInspectionDeterrent();

const rootElement = document.getElementById("root");
rootElement.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font:500 15px system-ui,sans-serif;color:#64748b">Yuklanmoqda…</div>';

// Avval Supabase'dagi ma'lumot yuklanadi, keyin ilova ochiladi.
// Uslublar avvalgi tartibda ulanadi: avval App, keyin global.css va motion.css.
startSupabase()
  .catch(() => {})
  .then(() => import("./App"))
  .then(async ({ default: App }) => {
    await import("./styles/global.css");
    await import("./styles/motion.css");
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
// Oyna, menyu va ro'yxatlar yopilganda teskari animatsiya.
installExitAnimations(document.body);
