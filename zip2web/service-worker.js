/* This service worker intercepts the requests the the "/play" folder and forwards
 * them to the page where the associated ZIP file is opened for it to decompress
 * the file. The result is then sent back to the browser as the request response.
 *
 * It also caches all the static resources from the site to make it available
 * offline as an installable PWA.
 */

const CACHE_NAME = 'zip2web-cache-v1';
const urlsToCache = [
  'arrows-fullscreen.svg',
  'drag-and-drop-128px.png',
  'fullscreen-exit.svg',
  'github-mark-pink.svg',
  'index.html',
  'indexStyle.css',
  'script.js',
  'zip2web-extra.js',
  'zip-fs-full.min.js',
];

const ZIP_CACHE_NAME = 'zip2web-zip-cache';

// play/<pageId>/<path>
const pathRE = new RegExp("/play/([^/]+)/(.*)(\\?.*)?$");

// Map of pending requests that will get resolved when the page send the response message
self.requests = {
  // id: {path, pageId, resolve, reject, time},
};
self.reqId = 0;
self.debug = true;

function debugLog(...args) {
  if(!self.debug) return;
  console.debug(...args);
}

self.addEventListener("fetch", (e) => {
  debugLog('SW', 'fetch', e);
  const m = pathRE.exec(e.request.url);
  if(m === null) {
    if(e.request.url.startsWith('http://127.0.0.1:')) {
      // Dev version, do not cache static files
      return e.respondWith(fetch(e.request));
    }

    e.respondWith(
      caches.match(e.request).then(response => {
        // Serve from cache if available
        if (response) {
          return response;
        }

        // Otherwise try network (will fail offline)
        return fetch(e.request);
      })
    );
    return;
  }

  const pageId = decodeURIComponent(m[1]);
  const path = decodeURIComponent(m[2]);

  e.respondWith(new Promise(async (resolve, reject) => {
    const client = await self.clients.get(pageId);
    if(client === undefined) {
      // Page has been closed/reloaded
      resolve(new Response(null, {
        status: 404,
      }));
      return;
    }

    // Check the cache first to prevent decompressing files too often
    const cache = await caches.open(ZIP_CACHE_NAME);
    const cachedResp = await cache.match(e.request);
    if(cachedResp) {
      return resolve(cachedResp);
    }

    const reqId = ++self.reqId;
    self.requests[reqId] = {
      path: path,
      pageId: pageId,
      resolve: resolve,
      reject: reject,
      time: Date.now(),  // TODO Remove stale requests
      url: e.request.url,
    };

    client.postMessage({name: 'getFile', id: reqId, path: path});
  }));
});

self.addEventListener("message", (e) => {
  debugLog('SW', 'message', e);
  const msg = e.data;
  const client = e.source;
  switch(msg.name) {
    case 'getPageId':
      client.postMessage({name: 'getPageId-resp', id: msg.id, pageId: client.id});
      break;

    case 'setDebug':
      self.debug = msg.enabled;
      break;

    case 'getFile-resp':
      const request = self.requests[msg.id];
      if(request === undefined) {
        console.error('File request ID not found', msg);
        break;
      }

      delete self.requests[msg.id];

      const headers = msg.headers !== undefined ? msg.headers : {};
      const status = msg.status !== undefined ? msg.status : 200;

      if(msg.error !== undefined) {
        request.resolve(new Response(null, {
          status: msg.error,  // FIXME That's redundant with status
          headers: headers,
        }));
      } else {
        let body, cacheBody;

        if(msg.stream !== undefined) {
          // cache.put() consumes the body so we need a full copy of it
          [body, cacheBody] = msg.stream.tee();
        } else {
          body = msg.content;
          // cache.put() consumes the body so we need a full copy of it
          cacheBody = body.slice();
        }

        // TODO Add other headers?
        const resp = new Response(body, {
          status: status,
          headers: headers,
        });

        const cacheResp = new Response(cacheBody, {
          status: status,
          headers: headers,
        });

        caches.open(ZIP_CACHE_NAME).then(cache => cache.put(request.url, cacheResp));
        request.resolve(resp);
      }
      break;

    default:
      console.error('Invalid message', e);
      client.postMessage({name: 'error', id: msg.id, text: `Invalid message: ${msg}`});
  }
});

self.addEventListener("install", function (event) {
  debugLog('SW', 'install');
  self.skipWaiting();

  // Cache all the required files
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", function (event) {
  debugLog('SW', 'activate');
  event.waitUntil(self.clients.claim());
  debugLog('SW', 'ready');
});