// ================================================================
// REALMETROPOLIS — Service Worker (Cliente)
// Estratégia: Cache-First para assets, Network-Only para API
// ================================================================

const VERSION    = "rm-cliente-v4";
const CACHE_STATIC = `${VERSION}-static`;

// Assets que ficam em cache offline
const PRECACHE = [
  "/minha-conta.html",
  "/reserva.html",
  "/cliente-manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            // Ignora se o asset não existir ainda (ícones podem não estar)
          })
        )
      )
    )
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 1. Só processar GET
  if (req.method !== "GET") return;

  // 2. API e autenticação — sempre rede, nunca cachear
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.includes("socket") ||
    req.headers.get("Authorization")
  ) {
    return; // passa directo para a rede sem interceptar
  }

  // 3. Recursos externos (CDN, fonts, mapas) — rede, sem cache
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4. Páginas e assets locais — Cache First, Network Fallback
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((response) => {
        // Só cachear respostas 200 de assets estáticos
        if (
          response.status === 200 &&
          (req.destination === "script" ||
           req.destination === "style"  ||
           req.destination === "image"  ||
           req.destination === "font"   ||
           req.destination === "document")
        ) {
          const toCache = response.clone();
          caches.open(CACHE_STATIC).then((cache) => cache.put(req, toCache));
        }
        return response;
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ───────────────────────────────────────────
self.addEventListener("push", (e) => {
  let payload = {};
  try { payload = e.data?.json() || {}; } catch { payload = {}; }

  const options = {
    body:    payload.body    || "Tem uma actualização na sua reserva.",
    icon:    payload.icon    || "/icons/icon-192.png",
    badge:                      "/icons/icon-192.png",
    tag:     payload.tag     || "rm-reserva",
    vibrate: [200, 100, 200],
    silent:  false,
    data:    { url: payload.url || "/minha-conta.html" },
    actions: [
      { action: "abrir",  title: "Ver detalhes" },
      { action: "fechar", title: "Dispensar"    },
    ],
  };

  e.waitUntil(
    self.registration.showNotification(
      payload.title || "REALMETROPOLIS",
      options
    )
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "fechar") return;

  const targetUrl = e.notification.data?.url || "/minha-conta.html";

  e.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const existing = windowClients.find((c) =>
          c.url === targetUrl || c.url.includes(targetUrl)
        );
        if (existing) return existing.focus();
        return clients.openWindow(targetUrl);
      })
  );
});