const IMAGE_CACHE_NAME = "global-client-images-v1";

function shouldCacheRequest(requestUrl, destination) {
  if (requestUrl.origin !== self.location.origin) {
    return false;
  }

  if (destination === "image") {
    return true;
  }

  return /\.(?:png|jpe?g|webp|gif|svg|avif)$/i.test(requestUrl.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith("global-client-images-") && cacheName !== IMAGE_CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    );

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (!shouldCacheRequest(requestUrl, request.destination)) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const cachedResponse = await cache.match(request);
    const networkPromise = fetch(request)
      .then((response) => {
        if (response.ok) {
          cache.put(request, response.clone());
        }

        return response;
      })
      .catch(() => null);

    if (cachedResponse) {
      event.waitUntil(networkPromise);
      return cachedResponse;
    }

    const networkResponse = await networkPromise;

    if (networkResponse) {
      return networkResponse;
    }

    return Response.error();
  })());
});