#!/usr/bin/env python3
"""Baut aus index.html die installierbare App-Version (PWA) in app/.

Aufruf:  python3 build_app.py
Ergebnis: app/index.html, app/manifest.webmanifest, app/sw.js (+ app/icons/ bleibt erhalten)
"""
import json
import pathlib
import re
import time

ROOT = pathlib.Path(__file__).parent
APP = ROOT / "app"
VERSION = time.strftime("%Y%m%d%H%M")

src = (ROOT / "index.html").read_text(encoding="utf-8")

# Der Artifact-Kopf (<title> + claude-Meta) wird durch einen vollständigen App-Kopf ersetzt
src = re.sub(r'<title>.*?</title>\s*<meta name="claude:viewport-fit-sides"[^>]*>\s*', "", src, count=1)

head = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Wesenwelt</title>
<meta name="description" content="Klassisches Monster-Rollenspiel in der Urzeit.">
<meta name="theme-color" content="#2a221c">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Wesenwelt">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>
:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
html{background:#14100d}
body{margin:0;font:14px system-ui,sans-serif;overscroll-behavior:none;touch-action:manipulation}
[hidden]{display:none!important}
/* Als installierte App: keine Tastatur-Hilfe, kein Vollbild-Knopf nötig */
@media (display-mode: standalone), (display-mode: fullscreen){ .help{display:none} #fs{display:none} }
</style>
"""

sw_register = f"""
<script>
if ('serviceWorker' in navigator) {{
  addEventListener('load', () => navigator.serviceWorker.register('sw.js?v={VERSION}').catch(() => {{}}));
}}
</script>
</body>
</html>
"""

# Der Body-Inhalt beginnt nach dem Stylesheet-Link-Block des Spiels
html = head + src.replace("</style>\n\n<div class=\"shell\">", "</style>\n</head>\n<body>\n<div class=\"shell\">", 1) + sw_register
(APP / "index.html").write_text(html, encoding="utf-8")

manifest = {
    "name": "Wesenwelt – Urzeit-Edition",
    "short_name": "Wesenwelt",
    "description": "Klassisches Monster-Rollenspiel in der Urzeit mit 16 Orden und 65 Wesen.",
    "lang": "de",
    "start_url": "./",
    "scope": "./",
    "display": "fullscreen",
    "display_override": ["fullscreen", "standalone"],
    "orientation": "any",
    "background_color": "#14100d",
    "theme_color": "#2a221c",
    "categories": ["games"],
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(APP / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

sw = f"""// Offline-Speicher für Wesenwelt (Version {VERSION})
const CACHE = 'wesenwelt-{VERSION}';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
self.addEventListener('install', e => {{ e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); }});
self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
}});
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  // Spielseite: erst Netz (für Updates), sonst Offline-Kopie. Alles andere: erst Offline-Kopie.
  if (e.request.mode === 'navigate') {{
    e.respondWith(fetch(e.request).then(r => {{ const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; }})
      .catch(() => caches.match('./index.html')));
    return;
  }}
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {{
    if (r.ok || r.type === 'opaque') {{ const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }}
    return r;
  }})));
}});
"""
(APP / "sw.js").write_text(sw, encoding="utf-8")
print(f"App gebaut: {APP} (Version {VERSION})")
