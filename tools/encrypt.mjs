// Verschlüsselt den Spielcode für die App: gzip + AES-256-GCM. Aufruf: node tools/encrypt.mjs <eingabe.js> <ausgabe.txt>
// Der Schlüssel kommt aus der Umgebungsvariable WW_KEY (64 Hex-Zeichen) und liegt sonst nur auf dem Konto-Server.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createCipheriv, randomBytes } from 'node:crypto';
const key = Buffer.from(process.env.WW_KEY || '', 'hex');
if (key.length !== 32) { console.error('WW_KEY fehlt oder ist ungültig'); process.exit(1); }
const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
const body = Buffer.concat([c.update(gzipSync(readFileSync(process.argv[2]))), c.final(), c.getAuthTag()]);
writeFileSync(process.argv[3], Buffer.concat([iv, body]).toString('base64'));
