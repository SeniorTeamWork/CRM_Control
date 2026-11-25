const https = require("https");
const { createProxyMiddleware } = require("http-proxy-middleware");

const CBU_USD_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/";
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function sendCbuResponse(res, url, redirects = 0) {
  const upstream = https.get(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "uz-UZ,uz;q=0.9,en-US;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    },
  }, (response) => {
    const location = response.headers.location;
    if (REDIRECT_CODES.has(response.statusCode) && location && redirects < 4) {
      response.resume();
      sendCbuResponse(res, new URL(location, url), redirects + 1);
      return;
    }
    res.statusCode = response.statusCode || 502;
    res.setHeader("Content-Type", response.headers["content-type"] || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    response.pipe(res);
  });
  upstream.setTimeout(20000, () => upstream.destroy(new Error("CBU request timed out")));
  upstream.on("error", (error) => {
    console.warn("[CBU USD proxy] Kurs olinmadi:", error.code || error.message);
    if (res.headersSent) return res.destroy(error);
    res.status(502).json({ error: "Markaziy bank kursini olib bo'lmadi." });
  });
}

module.exports = function setupProxy(app) {
  app.get("/api/currency/usd", (req, res) => {
    sendCbuResponse(res, CBU_USD_URL);
  });

  // package.json proxy o'rniga setupProxy ishlatilgani uchun avvalgi AI API proxy'sini saqlaymiz.
  app.use(createProxyMiddleware("/api", { target: "http://localhost:8787", changeOrigin: true }));
};
