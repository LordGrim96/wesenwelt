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
const cleanName = n => String(n || '').trim();
// Benutzernamen: 3 bis 20 Zeichen aus Buchstaben, Ziffern, _ und -. Groß/klein zählt beim Anmelden nicht.
const validName = n => /^[A-Za-z0-9ÄÖÜäöüß_-]{3,20}$/.test(n);
const RESERVED = new Set(['admin', 'administrator', 'entwickler', 'developer', 'system', 'support', 'wesenwelt', 'moderator', 'mod']);
const tempPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(10)); return [...b].map(x => a[x % a.length]).join(''); };
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
  return db.prepare('SELECT u.id, u.name, u.dev, u.admin, u.pw_hash, u.pw_salt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.blocked = 0')
    .bind(await sha256(m[1]), Date.now()).first();
}
async function playerSlots(db) {
  const r = await db.prepare("SELECT v FROM settings WHERE k = 'max_players'").first();
  const n = await db.prepare('SELECT COUNT(*) AS n, SUM(blocked) AS b FROM users WHERE admin = 0').first();
  return { max_players: r ? +r.v : -1, players: n.n, blocked: n.b || 0 };
}
const publicUser = u => ({ name: u.name, dev: !!(u.dev || u.admin), admin: !!u.admin });
const checkPassword = async (u, pw) => sameText(await pbkdf2(String(pw || ''), u.pw_salt), u.pw_hash);

async function handle(req, env) {
  const db = env.DB, url = new URL(req.url), path = url.pathname.replace(/\/+$/, ''), method = req.method;
  const ip = req.headers.get('cf-connecting-ip') || 'lokal';
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (path === '' || path === '/api') return json({ ok: true, name: 'Wesenwelt-Server', version: 1 });

  if (path === '/api/register' && method === 'POST') {
    if (!await allow(db, 'reg:' + ip, 10, 3600e3)) return fail(429, 'Zu viele neue Konten. Bitte später noch einmal versuchen.');
    const b = await readJson(req), name = cleanName(b.name);
    if (!validName(name)) return fail(400, 'Der Name braucht 3 bis 20 Zeichen: Buchstaben, Zahlen, _ oder -.');
    if (RESERVED.has(name.toLowerCase())) return fail(400, 'Dieser Name ist reserviert. Bitte einen anderen wählen.');
    if (!validPassword(b.password)) return fail(400, 'Das Passwort braucht mindestens 8 Zeichen.');
    if (await db.prepare('SELECT 1 FROM users WHERE name = ? COLLATE NOCASE').bind(name).first()) return fail(409, 'Diesen Namen gibt es schon. Bitte einen anderen wählen.');
    // Der Admin legt fest, wie viele Spieler ein Konto bekommen
    const slots = await playerSlots(db);
    if (slots.max_players >= 0 && slots.players >= slots.max_players) return fail(403, 'Es sind gerade keine Plätze frei. Frag den Entwickler nach einem Zugang.');
    const salt = rand(16), hash = await pbkdf2(b.password, salt);
    const r = await db.prepare('INSERT INTO users (name, pw_hash, pw_salt, created_at, last_login) VALUES (?, ?, ?, ?, ?)').bind(name, hash, salt, Date.now(), Date.now()).run();
    return json({ token: await newSession(db, r.meta.last_row_id), user: { name, dev: false, admin: false } });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readJson(req), name = cleanName(b.name);
    if (!await allow(db, 'login-ip:' + ip, 30, 900e3) || !await allow(db, 'login:' + name.toLowerCase(), 10, 900e3)) return fail(429, 'Zu viele Versuche. Bitte in 15 Minuten noch einmal.');
    const u = name ? await db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').bind(name).first() : null;
    // Auch ohne Konto wird gerechnet, damit die Antwortzeit nichts verrät
    const hash = await pbkdf2(String(b.password || ''), u ? u.pw_salt : '00'.repeat(16));
    if (!u || !sameText(hash, u.pw_hash)) return fail(401, 'Name oder Passwort stimmt nicht.');
    if (u.blocked) return fail(403, 'Dein Zugang ist gesperrt. Frag den Entwickler.');
    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(Date.now(), u.id).run();
    return json({ token: await newSession(db, u.id), user: publicUser(u) });
  }

  // Ab hier nur mit Anmeldung
  const user = await currentUser(req, db);
  if (!user) return fail(401, 'Bitte neu anmelden.');

  if (path === '/api/me' && method === 'GET') return json({ user: publicUser(user) });

  // Schlüssel für das verschlüsselte Spiel: nur für angemeldete, nicht gesperrte Spieler
  if (path === '/api/gamekey' && method === 'GET') {
    const r = await db.prepare("SELECT v FROM settings WHERE k = 'game_key'").first();
    if (!r) return fail(503, 'Das Spiel ist noch nicht eingerichtet.');
    // Jeder Spielstart zählt als „zuletzt da“
    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(Date.now(), user.id).run();
    return json({ key: r.v, user: publicUser(user) });
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = (req.headers.get('authorization') || '').slice(7);
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true });
  }

  if (path === '/api/me' && method === 'DELETE') {
    const b = await readJson(req);
    if (!await allow(db, 'del:' + user.id, 10, 3600e3)) return fail(429, 'Zu viele Versuche.');
    if (!await checkPassword(user, b.password)) return fail(403, 'Das Passwort stimmt nicht.');
    if (user.admin) return fail(403, 'Das Admin-Konto kann nicht gelöscht werden.');
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
    return json({ user: { ...publicUser(user), dev: true } });
  }

  if (path === '/api/password' && method === 'POST') {
    if (!await allow(db, 'pw:' + user.id, 10, 3600e3)) return fail(429, 'Zu viele Versuche.');
    const b = await readJson(req);
    if (!await checkPassword(user, b.old)) return fail(403, 'Das alte Passwort stimmt nicht.');
    if (!validPassword(b.password)) return fail(400, 'Das neue Passwort braucht mindestens 8 Zeichen.');
    const salt = rand(16), token = (req.headers.get('authorization') || '').slice(7);
    // Alle anderen Geräte werden abgemeldet, dieses bleibt angemeldet
    await db.batch([
      db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await pbkdf2(b.password, salt), salt, user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, await sha256(token)),
    ]);
    return json({ ok: true });
  }

  // Spielerverwaltung, nur für Admins
  if (path.startsWith('/api/admin/')) {
    if (!user.admin) return fail(403, 'Nur für Admins.');
    if (path === '/api/admin/settings' && method === 'GET') return json(await playerSlots(db));
    if (path === '/api/admin/settings' && method === 'POST') {
      const b = await readJson(req), max = Number(b.max_players);
      if (!Number.isInteger(max) || max < -1 || max > 10000) return fail(400, 'Ungültige Zahl.');
      await db.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('max_players', ?)").bind(String(max)).run();
      return json(await playerSlots(db));
    }
    if (path === '/api/admin/users' && method === 'GET') {
      const r = await db.prepare('SELECT u.id, u.name, u.dev, u.admin, u.blocked, u.created_at, u.last_login, (SELECT COUNT(*) FROM saves s WHERE s.user_id = u.id) AS saves, (SELECT MAX(saved_at) FROM saves s WHERE s.user_id = u.id) AS last_save FROM users u ORDER BY u.created_at DESC LIMIT 500').all();
      return json({ users: r.results.map(u => ({ ...u, dev: !!u.dev, admin: !!u.admin, blocked: !!u.blocked })) });
    }
    const am = /^\/api\/admin\/users\/(\d+)(?:\/(reset|dev|block))?$/.exec(path);
    const target = am && await db.prepare('SELECT id, name, admin FROM users WHERE id = ?').bind(+am[1]).first();
    if (!target) return fail(404, 'Diesen Spieler gibt es nicht.');
    if (target.id === user.id) return fail(403, 'Dein eigenes Konto änderst du unter KONTO → PASSWORT ÄNDERN.');
    if (target.admin) return fail(403, 'Andere Admins kann man hier nicht ändern.');
    if (am[2] === 'reset' && method === 'POST') {
      const pw = tempPassword(), salt = rand(16);
      await db.batch([
        db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await pbkdf2(pw, salt), salt, target.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
      ]);
      return json({ name: target.name, password: pw });
    }
    if (am[2] === 'block' && method === 'POST') {
      const b = await readJson(req);
      // Sperren meldet den Spieler sofort auf allen Geräten ab
      await db.batch([
        db.prepare('UPDATE users SET blocked = ? WHERE id = ?').bind(b.blocked ? 1 : 0, target.id),
        ...(b.blocked ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id)] : []),
      ]);
      return json({ ok: true });
    }
    if (am[2] === 'dev' && method === 'POST') {
      const b = await readJson(req);
      await db.prepare('UPDATE users SET dev = ? WHERE id = ?').bind(b.dev ? 1 : 0, target.id).run();
      return json({ ok: true });
    }
    if (!am[2] && method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM saves WHERE user_id = ?').bind(target.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
        db.prepare('DELETE FROM users WHERE id = ?').bind(target.id),
      ]);
      return json({ ok: true });
    }
    return fail(404, 'Unbekannte Anfrage.');
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
