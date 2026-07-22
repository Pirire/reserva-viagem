/* Realmetropolis — Service Worker (PWA)
 *
 * PROPOSITO UNICO: existir para o site poder ser instalado como app.
 *
 * NAO intercepta pedidos. A versao anterior fazia cache de TODOS os
 * GET — incluindo as chamadas /api/ — e quando algo corria mal
 * devolvia vazio, o que aparecia ao utilizador como "Failed to fetch"
 * (ex.: no pedido de recolha). Tambem apagava as caches de outros
 * service workers, incluindo a da app do motorista.
 *
 * O motorista tem o seu proprio SW dedicado (motorista-sw.js), que faz
 * cache de forma cuidada e ignora /api/. Este nao deve competir com ele.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Limpar APENAS as caches criadas por versoes anteriores DESTE sw.
  // Nunca tocar nas de outros (ex.: rm-motorista-*).
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes.filter((n) => n.startsWith("rm-cache-")).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Handler presente (necessario para a app ser instalavel) mas que NAO
// chama respondWith — ou seja, todos os pedidos seguem o caminho normal
// do browser, exactamente como se este ficheiro nao existisse.
self.addEventListener("fetch", () => {});