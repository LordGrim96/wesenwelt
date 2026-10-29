#!/usr/bin/env python3
"""Baut aus index.html die installierbare App-Version (PWA) in app/.

Aufruf:  python3 build_app.py
Ergebnis: app/index.html, app/manifest.webmanifest, app/sw.js (+ app/icons/ bleibt erhalten)
"""
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).parent
APP = ROOT / "app"
VERSION = os.environ.get("WW_VERSION") or time.strftime("%Y%m%d%H%M")

src = (ROOT / "index.html").read_text(encoding="utf-8")

# Der Artifact-Kopf (<title> + claude-Meta) wird durch einen vollständigen App-Kopf ersetzt
src = re.sub(r'<title>.*?</title>\s*<meta name="claude:viewport-fit-sides"[^>]*>\s*(?:<meta name="viewport"[^>]*>\s*)?', "", src, count=1)
# Versionsnummer ins Spiel schreiben (steht auf dem Titelbild und wird mit dem Offline-Speicher verglichen)
src, n = re.subn(r"const GAME_VERSION = '[^']*';", f"const GAME_VERSION = '{VERSION}';", src, count=1)
assert n == 1, "GAME_VERSION nicht gefunden"
# Konto-Server nur in der echten App (in der Vorschau bleibt das Spiel reines Gast-Spiel)
API = os.environ.get("WW_API", "https://wesenwelt-api.edengrim67.workers.dev")
src, n = re.subn(r"  api: '',", f"  api: '{API}',", src, count=1)
assert n == 1, "CONFIG.api nicht gefunden"

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
@media (display-mode: standalone), (display-mode: fullscreen){ #fs{display:none} }
</style>
"""

sw_register = """
<script>
// Automatische Updates: regelmäßig und beim Öffnen nach einer neuen Version suchen.
// Meldet der Offline-Speicher eine andere Version, lädt das Spiel in einem sicheren Moment neu.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'version' && typeof GAME_VERSION !== 'undefined' && e.data.v !== GAME_VERSION) dispatchEvent(new Event('wesenwelt-update'));
  });
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      const check = () => reg.update().catch(() => {});
      setInterval(check, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      addEventListener('online', check);
    } catch (e) {}
  });
}
</script>
</body>
</html>
"""

# Verschlüsselung: Mit WW_KEY wird der Spielcode verschlüsselt eingebettet und erst nach der Anmeldung entschlüsselt
KEY = os.environ.get("WW_KEY", "")
if KEY:
    s0 = src.index("<script>\n'use strict'"); s1 = src.index("</script>", s0)
    code = src[s0 + len("<script>"):s1]
    with tempfile.TemporaryDirectory() as tmp:
        fin, fout = pathlib.Path(tmp) / "game.js", pathlib.Path(tmp) / "game.enc"
        fin.write_text(code, encoding="utf-8")
        subprocess.run(["node", str(ROOT / "tools" / "encrypt.mjs"), str(fin), str(fout)], check=True)
        blob = fout.read_text()
    gate = (ROOT / "tools" / "gate.html").read_text(encoding="utf-8").replace("__API__", API)
    src = src[:s0] + gate + '\n<script type="application/octet-stream" id="ww-data">' + blob + "</script>" + src[s1 + len("</script>"):]
    print("Spielcode verschlüsselt")

# Der Body-Inhalt beginnt nach dem Stylesheet-Link-Block des Spiels
body_start = src.index('<div class="game"')
assert body_start > 0, "Spielbereich nicht gefunden"
html = head + src[:body_start] + "</head>\n<body>\n" + src[body_start:] + sw_register
(APP / "index.html").write_text(html, encoding="utf-8")

manifest = {
    "name": "Wesenwelt – Urzeit-Edition",
    "short_name": "Wesenwelt",
    "description": "Klassisches Monster-Rollenspiel in der Urzeit mit 16 Orden und 80 Wesen.",
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
const VERSION = '{VERSION}';
const CACHE = 'wesenwelt-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
self.addEventListener('install', e => {{
  // cache: 'reload' umgeht den Zwischenspeicher von GitHub Pages, damit wirklich die neue Version landet
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {{ cache: 'reload' }})))));
  self.skipWaiting();
}});
self.addEventListener('activate', e => {{
  e.waitUntil((async () => {{
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    for (const c of await self.clients.matchAll({{ includeUncontrolled: true }})) c.postMessage({{ type: 'version', v: VERSION }});
  }})());
}});
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  // Spielseite: erst Netz (für Updates), sonst Offline-Kopie. Alles andere: erst Offline-Kopie.
  if (e.request.mode === 'navigate') {{
    e.respondWith(fetch(e.request.url, {{ cache: 'no-cache', credentials: 'same-origin' }})
      .then(r => {{ const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; }})
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
