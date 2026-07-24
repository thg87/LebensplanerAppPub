/* Manifest version: nZ5Hwqpo */
// Caution! Be sure you understand the caveats before publishing an application with
// offline support. See https://aka.ms/blazor-offline-considerations

self.importScripts('./service-worker-assets.js');
self.addEventListener('install', event => event.waitUntil(onInstall(event)));
self.addEventListener('activate', event => event.waitUntil(onActivate(event)));
self.addEventListener('fetch', event => event.respondWith(onFetch(event)));

// Ohne das hier bleibt eine neue Fassung liegen, bis die letzte Instanz der App
// geschlossen wird — und eine Homescreen-App wird nie geschlossen. Im Browser
// nachgemessen: Nach dem Neuveröffentlichen lag die neue Fassung *vollständig*
// auf dem Gerät (beide Caches nebeneinander, dieser Worker im Zustand
// `installed`), und der Nutzer sah trotzdem weiter die alte. Freigegeben wurde
// sie erst, als der letzte Tab die Seite verlassen hatte.
//
// `skipWaiting` wird deshalb *nicht* von selbst gerufen, sondern nur auf
// Ansage: Die App fragt den Nutzer und lädt danach neu. Von selbst zu
// übernehmen hieße, den Cache unter einer laufenden Seite auszutauschen — bei
// einer WASM-App, die Assemblies nachlädt, ist das riskanter als es klingt.
self.addEventListener('message', event => {
    if (event.data && event.data.typ === 'UEBERNEHMEN') {
        self.skipWaiting();
    }
});

const cacheNamePrefix = 'offline-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;
// `\.woff2?$` statt nur `\.woff$`: Die selbst gehostete Anzeige-Schrift „Space
// Grotesk" (ADR 0014) liegt als `.woff2` vor. `\.woff$` matchte die *nicht* (das `$`
// verlangt das Ende direkt nach „woff", die Datei endet aber auf „woff2"). Damit
// blieb die Schrift aus dem Offline-Cache — auf einer Homescreen-App ohne Netz
// wäre die Anzeige-Schrift dann still auf den Fallback zurückgefallen. Offline ist
// der Normalfall, kein Sonderfall (CLAUDE.md, Regel 2).
const offlineAssetsInclude = [ /\.dll$/, /\.pdb$/, /\.wasm/, /\.html/, /\.js$/, /\.json$/, /\.css$/, /\.woff2?$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.blat$/, /\.dat$/, /\.webmanifest$/ ];
const offlineAssetsExclude = [ /^service-worker\.js$/ ];

// Replace with your base path if you are hosting on a subfolder. Ensure there is a trailing '/'.
const base = "/";
const baseUrl = new URL(base, self.origin);
const manifestUrlList = self.assetsManifest.assets.map(asset => new URL(asset.url, baseUrl).href);

async function onInstall(event) {
    console.info('Service worker: Install');

    // Fetch and cache all matching items from the assets manifest
    const assetsRequests = self.assetsManifest.assets
        .filter(asset => offlineAssetsInclude.some(pattern => pattern.test(asset.url)))
        .filter(asset => !offlineAssetsExclude.some(pattern => pattern.test(asset.url)))
        .map(asset => new Request(asset.url, { integrity: asset.hash, cache: 'no-cache' }));
    await caches.open(cacheName).then(cache => cache.addAll(assetsRequests));
}

async function onActivate(event) {
    console.info('Service worker: Activate');

    // Delete unused caches
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys
        .filter(key => key.startsWith(cacheNamePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));
}

async function onFetch(event) {
    let cachedResponse = null;
    if (event.request.method === 'GET') {
        // For all navigation requests, try to serve index.html from cache,
        // unless that request is for an offline resource.
        // If you need some URLs to be server-rendered, edit the following check to exclude those URLs
        const shouldServeIndexHtml = event.request.mode === 'navigate'
            && !manifestUrlList.some(url => url === event.request.url);

        const request = shouldServeIndexHtml ? 'index.html' : event.request;
        const cache = await caches.open(cacheName);
        cachedResponse = await cache.match(request);
    }

    return cachedResponse || fetch(event.request);
}
