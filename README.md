# Wesenwelt – Urzeit-Edition

Ein klassisches Monster-Rollenspiel im Stil der alten Handheld-Spiele, angesiedelt in der Urzeit.

- 2 Regionen (Jurania und Kreidara), 16 Arenen, 16 Orden und der Meteorgipfel
- 80 eigene Urzeit-Wesen mit Typen, Werten, Entwicklungen und Urdex-Einträgen
- Gebiete mit eigenem Wetter: Urwald, Vulkan, Eiszeit, Wüste und Sumpf
- Tag und Nacht nach echter Uhrzeit
- Als App installierbar (PWA), läuft offline

## Spielen

**▶ https://lordgrim96.github.io/wesenwelt/**

Die App wird bei jedem Push auf `main` automatisch auf GitHub Pages veröffentlicht.
Auf dem Handy die Seite öffnen und „App installieren“ (Android) bzw. „Zum Home-Bildschirm“ (iPhone) wählen.

## Steuerung

| Taste | Funktion |
| --- | --- |
| Pfeile (oder WASD) | laufen |
| Leertaste (oder Z) | A: sprechen, bestätigen |
| Umschalt (oder X, Esc) | B: zurück, gedrückt halten = rennen |
| Enter | Menü |
| M | Karte |
| Alt+T | Tageszeit durchschalten (Test) |
| Alt+N | durch Wände laufen (Test) |

## Aufbau

- `index.html` – das komplette Spiel in einer Datei
- `build_app.py` – baut daraus die installierbare App in `app/`
- `app/icons/` – App-Icons
- `v1-gameboy.html` – die erste Version im Game-Boy-Stil

Die Wesen, Orte und Grafiken sind eigene Entwürfe und stammen nicht aus offiziellen Spielen.

## Konten (Cloudflare)

Der Ordner `worker/` ist ein kleiner Server (Cloudflare Workers + D1) für Konten und Cloud-Spielstände.
Er wird bei jeder Änderung automatisch veröffentlicht (`.github/workflows/worker.yml`), sobald im GitHub-Projekt
die Geheimnisse `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` hinterlegt sind. Die Server-Adresse steht im Spiel unter `CONFIG.api`.
Gespielt wird nur mit Konto: Die veröffentlichte App enthält den Spielcode verschlüsselt (`tools/encrypt.mjs`, `tools/gate.html`).
Den Schlüssel gibt der Server nur angemeldeten, nicht gesperrten Spielern; danach bleibt er auf dem Gerät, damit man auch offline spielen kann.
Admins öffnen die GOAT-Übersicht auf dem Titelbild mit SELECT.

## Lizenz

[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.de) (siehe `LICENSE`): kostenlos spielen und unverändert teilen, mit Namensnennung und ohne Geld damit zu verdienen. Veränderte Versionen sind nicht erlaubt – Änderungen am Spiel macht nur der Urheber.
