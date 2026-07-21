/* Realmetropolis — Service Worker (PWA)
   Estratégia simples e segura: network-first.
   O SW existe sobretudo para tornar o site instalável como app.
   Não faz cache agressivo (para não servir versões antigas por engano)
   — vai sempre à rede primeiro; se falhar, tenta o que estiver em cache. */

const CACHE = "rm-cache-v1";

// Ao instalar, ativa logo (não espera por fechar separadores)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Ao ativar, limpa caches antigos de versões anteriores
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: tenta a rede; se falhar (offline), usa a cache
self.addEventListener("fetch", (event) => {
  // Só trata pedidos GET do próprio site
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        // Guarda uma cópia na cache para uso offline
        const copia = resposta.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copia)).catch(() => {});
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});
