-- Admin- und Entwickler-Konto für LordGrim96 (Passwort nur als PBKDF2-Hash gespeichert)
INSERT OR IGNORE INTO users (name, pw_hash, pw_salt, dev, admin, created_at) VALUES ('LordGrim96', '30e4826dafb5046f87027dbed08bd5e07d012286f2759843727761b4594515ed', '6198fbe9f030b1add6ea70b228dbdec1', 1, 1, 1793196312608);
UPDATE users SET dev = 1, admin = 1 WHERE name = 'LordGrim96' COLLATE NOCASE;
