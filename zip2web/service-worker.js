/** This service worker is a way to play HTML files located in MEMFS.
 * It forwards fetch requests to the rags2html page so it can extract the resources
 * and send them back to the browser.
 */

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
  if(m === null) return;

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

    const reqId = ++self.reqId;
    self.requests[reqId] = {
      path: path,
      pageId: pageId,
      resolve: resolve,
      reject: reject,
      time: Date.now(),  // TODO Remove stale requests
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
        // TODO Add other headers?
        request.resolve(new Response(msg.content, {
          status: status,
          headers: headers,
        }));
      }
      break;

    default:
      console.error('Invalid message', e);
      client.postMessage({name: 'error', id: msg.id, text: `Invalid message: ${msg}`});
  }
});

self.addEventListener("install", function () {
  debugLog('SW', 'install');
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  debugLog('SW', 'activate');
  event.waitUntil(self.clients.claim());
  debugLog('SW', 'ready');
});