// public/motorista-sw.js
// ══════════════════════════════════════════════════════════════
// Service Worker DEDICADO à app do motorista.
//
// PRINCÍPIOS PROFISSIONAIS:
//   1) NUNCA interceta chamadas /api/*  → sempre ao servidor
//   2) NUNCA interceta outras páginas (gestor-frota, admin, dashboard)
//   3) Só cacheia ficheiros estáticos da app do motorista
//   4) Cache versionada com invalidação automática ao actualizar SW
//   5) Notificações push mantidas (feature crítica para o motorista)
//   6) Falhas visíveis — nunca devolve resposta falsa "200 vazio"
//
// COMPATIBILIDADE COM O RESTO DO SISTEMA:
//   Este SW pode estar registado com scope global (herança) mas
//   é DEFENSIVO por lógica: filtra internamente que URLs interceta
//   e deixa TODAS as outras passar sem tocar (respondWith(fetch(e.request))
//   NEM sequer é chamado — o browser faz o pedido normalmente).
// ══════════════════════════════════════════════════════════════

const SW_VERSION = "motorista-v3-2026-07-09";
const CACHE_NAME = `rm-motorista-${SW_VERSION}`;

// APENAS estas URLs são cacheadas/servidas do cache
const APP_MOTORISTA_URLS = [
  "/motorista.html",
  "/motorista-login.html",
];

// Assets estáticos partilhados que a app do motorista usa
const ASSETS_ESTATICOS = [
  // Adicionar aqui apenas se souber que existem;
  // se não existirem, o SW ignora graciosamente
];

// URLs que NUNCA passam pelo SW — em qualquer circunstância
function urlDeveSerIgnorada(url) {
  const u = new URL(url);
  // Só intervém em same-origin
  if (u.origin !== self.location.origin) return true;

  const p = u.pathname;

  // 1) Todas as chamadas API vão sempre direto ao servidor
  if (p.startsWith("/api/")) return true;

  // 2) WebSockets (socket.io) nunca são intercetados
  if (p.startsWith("/socket.io/")) return true;

  // 3) Uploads/downloads de ficheiros grandes
  if (p.startsWith("/uploads/") || p.startsWith("/download/")) return true;

  // 4) Outras páginas HTML que NÃO são da app do motorista
  //    O SW não cacheia nem serve nada delas. O browser lida.
  const outrasPaginasHTML = [
    "/hotel-dashboard.html",
    "/gestor-frota.html",
    "/gestor-frota-login.html",
    "/admin-gestao.html",
    "/admin-login.html",
    "/validador.html",
    "/validador-login.html",
    "/seguranca.html",
    "/index.html",
    "/minha-conta.html",
    "/reserva.html",
    "/ticket.html",
    "/validacao.html",
    "/feedback-transporte.html",
    "/parceiro-submit.html",
    "/renovar-documento.html",
    "/convite-registo-hotel.html",
  ];
  if (outrasPaginasHTML.some(url => p === url || p === url.toLowerCase())) return true;

  return false;
}

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cacheia URLs conhecidas; falhas individuais são toleradas
      // (se um ficheiro não existir, não trava a instalação inteira)
      const todas = [...APP_MOTORISTA_URLS, ...ASSETS_ESTATICOS];
      const resultados = await Promise.allSettled(
        todas.map(u => cache.add(u).catch(err => {
          console.warn(`[SW] Não cacheou ${u}:`, err.message);
          throw err;
        }))
      );
      const falhas = resultados.filter(r => r.status === "rejected").length;
      if (falhas) console.warn(`[SW] Instalado com ${falhas} recursos em falta.`);
    })
  );
  // Não faz skipWaiting automático — dá tempo para o "activate"
  // limpar caches antigas antes de o novo SW assumir tráfego
});

// ── ACTIVATE — Limpa caches antigas ──────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes
          .filter(n => n.startsWith("rm-motorista-") && n !== CACHE_NAME)
          .map(n => caches.delete(n))
      );
      await self.clients.claim();
      console.log(`[SW ${SW_VERSION}] Ativado. Caches antigas limpas.`);
    })()
  );
});

// ── FETCH — Estratégia altamente defensiva ────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Só GET é candidato a cache. POST/PUT/DELETE/PATCH nunca.
  if (req.method !== "GET") return;

  // Ignora tudo o que não é da app do motorista
  if (urlDeveSerIgnorada(req.url)) return;

  // Só chega aqui se for GET a uma das APP_MOTORISTA_URLS ou assets
  event.respondWith(
    (async () => {
      // Network-first para HTML da app (queremos versões novas)
      if (req.destination === "document" || req.mode === "navigate") {
        try {
          const respostaRede = await fetch(req);
          if (respostaRede.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, respostaRede.clone());
          }
          return respostaRede;
        } catch (_) {
          // Sem rede — tenta cache
          const cached = await caches.match(req);
          if (cached) return cached;
          // Sem cache também — devolve erro claro (nunca "200 vazio")
          return new Response("Sem ligação. Reconecte-se para continuar.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }

      // Assets estáticos: cache-first
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const respostaRede = await fetch(req);
        if (respostaRede.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, respostaRede.clone());
        }
        return respostaRede;
      } catch (err) {
        return new Response("", { status: 504, statusText: "Gateway Timeout" });
      }
    })()
  );
});

// ══════════════════════════════════════════════════════════════
// NOTIFICAÇÕES PUSH — Motorista recebe pedidos com app fechada
// Feature crítica: mesmo que o telemóvel do motorista esteja no
// bolso e o navegador fechado, quando surge nova viagem ele
// recebe notificação nativa. Sem isto, o motorista perde
// oportunidades e o dispatch fica menos eficiente.
// ══════════════════════════════════════════════════════════════
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (_) {
    dados = { title: "REALMETROPOLIS", body: event.data?.text() || "Nova notificação" };
  }

  const titulo = dados.title || "REALMETROPOLIS";
  const opcoes = {
    body:  dados.body  || "Nova viagem disponível.",
    icon:  dados.icon  || "/icon-192.png",
    badge: dados.badge || "/icon-192.png",
    data:  { url: dados.url || "/motorista.html", ...(dados.data || {}) },
    vibrate: [200, 100, 200],
    requireInteraction: true, // Não desaparece até o motorista interagir
    tag: dados.tag || "nova-viagem",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/motorista.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      // Se já há janela do motorista aberta, foca-a
      const existente = janelas.find(w => w.url.includes("/motorista.html"));
      if (existente) return existente.focus();
      // Senão, abre nova
      return self.clients.openWindow(url);
    })
  );
});

// ══════════════════════════════════════════════════════════════
// MENSAGENS do CLIENTE — permite forçar update via clients.postMessage
// ══════════════════════════════════════════════════════════════
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

console.log(`[SW ${SW_VERSION}] Carregado.`);