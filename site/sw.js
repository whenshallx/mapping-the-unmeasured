const CACHE='mapping-b2c08e801339';
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('mapping-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}catch(error){const saved=await cache.match(event.request);if(saved)return saved;throw error;}})());});
