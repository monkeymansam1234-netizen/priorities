// Offline support: the app's own files are fetched fresh when online and served
// from cache when not. Supabase traffic is never cached.
var CACHE = "priorities-v1";

var SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

// Pinned versions, so cache-first is safe.
var LIBS = [
  "https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL.concat(LIBS));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    var network = fetch(request).then(function (response) {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
    network.catch(function () {});
    // Don't leave the user staring at a blank screen on a bad connection.
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
    return Promise.race([network, timeout]).then(function (response) {
      return response || cache.match(request, { ignoreSearch: true }).then(function (hit) { return hit || network; });
    }).catch(function () {
      return cache.match(request, { ignoreSearch: true }).then(function (hit) {
        return hit || (request.mode === "navigate" ? cache.match("index.html") : Response.error());
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);

  if (LIBS.indexOf(request.url) !== -1) {
    event.respondWith(caches.match(request).then(function (hit) { return hit || fetch(request); }));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
