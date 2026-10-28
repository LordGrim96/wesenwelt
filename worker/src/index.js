/* =====================================================================
   WESENWELT – Server für Konten und Cloud-Spielstände
   Cloudflare Worker + D1-Datenbank. Passwörter werden nur als
   PBKDF2-Hash gespeichert, Anmeldungen als Hash eines Zufallsschlüssels.
   ===================================================================== */

// Gleicher Hash wie im Spiel: das Entwickler-Passwort schaltet den Entwicklermodus für ein Konto frei
const DEV_HASH = 'f7a8160978b77c6c56e18a5347972c11efcb80295d7339ba08c6a9c3c4866e9b';
const SESSION_DAYS = 90;
const MAX_SAVE = 300 * 1024;
const SLOTS = 3;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
const fail = (status, error) => json({ error }, status);

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100000 }, key, 256));
}
function sameText(a, b) {
  // Vergleich mit gleicher Laufzeit, damit man Hashes nicht über die Antwortzeit erraten kann
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Höchstens `max` Versuche pro Zeitfenster und Schlüssel (IP-Adresse oder E-Mail)
async function allow(db, k, max, windowMs) {
  const now = Date.now();
  const r = await db.prepare('SELECT n, reset_at FROM hits WHERE k = ?').bind(k).first();
  if (!r || r.reset_at < now) { await db.prepare('INSERT OR REPLACE INTO hits (k, n, reset_at) VALUES (?, 1, ?)').bind(k, now + windowMs).run(); return true; }
  if (r.n >= max) return false;
  await db.prepare('UPDATE hits SET n = n + 1 WHERE k = ?').bind(k).run();
  return true;
}

async function readJson(req, limit = 4096) {
  const text = await req.text();
  if (text.length > limit) throw new Error('too_large');
  try { return JSON.parse(text || '{}'); } catch (e) { throw new Error('bad_json'); }
}
const cleanEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

async function newSession(db, userId) {
  const token = rand(32), now = Date.now();
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, now).run();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, now + SESSION_DAYS * 864e5).run();
  return token;
}
async function currentUser(req, db) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  return db.prepare('SELECT u.id, u.email, u.dev, u.pw_hash, u.pw_salt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(m[1]), Date.now()).first();
}
const publicUser = u => ({ email: u.email, dev: !!u.dev });

async function handle(req, env) {
  const db = env.DB, url = new URL(req.url), path = url.pathname.replace(/\/+$/, ''), method = req.method;
  const ip = req.headers.get('cf-connecting-ip') || 'lokal';
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (path === '' || path === '/api') return json({ ok: true, name: 'Wesenwelt-Server', version: 1 });

  if (path === '/api/register' && method === 'POST') {
    if (!await allow(db, 'reg:' + ip, 10, 3600e3)) return fail(429, 'Zu viele neue Konten. Bitte später noch einmal versuchen.');
    const b = await readJson(req), email = cleanEmail(b.email);
    if (!validEmail(email)) return fail(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
    if (!validPassword(b.password)) return fail(400, 'Das Passwort braucht mindestens 8 Zeichen.');
    if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return fail(409, 'Mit dieser E-Mail gibt es schon ein Konto. Bitte anmelden.');
    const salt = rand(16), hash = await pbkdf2(b.password, salt);
    const r = await db.prepare('INSERT INTO users (email, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?)').bind(email, hash, salt, Date.now()).run();
    const id = r.meta.last_row_id;
    return json({ token: await newSession(db, id), user: { email, dev: false } });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readJson(req), email = cleanEmail(b.email);
    if (!await allow(db, 'login-ip:' + ip, 30, 900e3) || !await allow(db, 'login:' + email, 10, 900e3)) return fail(429, 'Zu viele Versuche. Bitte in 15 Minuten noch einmal.');
    const u = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    // Auch ohne Konto wird gerechnet, damit die Antwortzeit nichts verrät
    const hash = await pbkdf2(String(b.password || ''), u ? u.pw_salt : '00'.repeat(16));
    if (!u || !sameText(hash, u.pw_hash)) return fail(401, 'E-Mail oder Passwort stimmt nicht.');
    return json({ token: await newSession(db, u.id), user: publicUser(u) });
  }

  // Ab hier nur mit Anmeldung
  const user = await currentUser(req, db);
  if (!user) return fail(401, 'Bitte neu anmelden.');

  if (path === '/api/me' && method === 'GET') return json({ user: publicUser(user) });

  if (path === '/api/logout' && method === 'POST') {
    const token = (req.headers.get('authorization') || '').slice(7);
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true });
  }

  if (path === '/api/me' && method === 'DELETE') {
    const b = await readJson(req);
    if (!await allow(db, 'del:' + user.id, 10, 3600e3)) return fail(429, 'Zu viele Versuche.');
    if (!sameText(await pbkdf2(String(b.password || ''), user.pw_salt), user.pw_hash)) return fail(403, 'Das Passwort stimmt nicht.');
    await db.batch([
      db.prepare('DELETE FROM saves WHERE user_id = ?').bind(user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/dev' && method === 'POST') {
    if (!await allow(db, 'dev:' + user.id, 10, 3600e3)) return fail(429, 'Zu viele Versuche.');
    const b = await readJson(req);
    if (await sha256('wesenwelt:' + String(b.password || '')) !== DEV_HASH) return fail(403, 'Falsches Passwort.');
    await db.prepare('UPDATE users SET dev = 1 WHERE id = ?').bind(user.id).run();
    return json({ user: { email: user.email, dev: true } });
  }

  if (path === '/api/saves' && method === 'GET') {
    const r = await db.prepare('SELECT slot, data, saved_at FROM saves WHERE user_id = ? ORDER BY slot').bind(user.id).all();
    return json({ saves: r.results });
  }

  const sm = /^\/api\/saves\/(\d)$/.exec(path);
  if (sm) {
    const slot = +sm[1];
    if (slot >= SLOTS) return fail(400, 'Ungültiger Platz.');
    if (method === 'PUT') {
      let d; try { d = await readJson(req, MAX_SAVE); } catch (e) { return fail(413, 'Spielstand ist zu groß.'); }
      if (!d || typeof d !== 'object' || !Array.isArray(d.team)) return fail(400, 'Ungültiger Spielstand.');
      const at = Number.isFinite(d.savedAt) ? Math.min(d.savedAt, Date.now() + 60e3) : Date.now();
      const old = await db.prepare('SELECT saved_at FROM saves WHERE user_id = ? AND slot = ?').bind(user.id, slot).first();
      // Ein älterer Stand überschreibt nie einen neueren (z. B. wenn ein Handy lange offline war)
      if (old && old.saved_at > at) return json({ ok: false, newer: true });
      await db.prepare('INSERT OR REPLACE INTO saves (user_id, slot, data, saved_at) VALUES (?, ?, ?, ?)').bind(user.id, slot, JSON.stringify(d), at).run();
      return json({ ok: true, saved_at: at });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM saves WHERE user_id = ? AND slot = ?').bind(user.id, slot).run();
      return json({ ok: true });
    }
  }
  return fail(404, 'Unbekannte Anfrage.');
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) {
      if (e.message === 'bad_json' || e.message === 'too_large') return fail(400, 'Ungültige Anfrage.');
      console.error(e);
      return fail(500, 'Serverfehler. Bitte später noch einmal versuchen.');
    }
  },
};
