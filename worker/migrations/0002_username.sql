-- Anmeldung mit Benutzernamen statt E-Mail. Bisherige Konten melden sich mit ihrer alten E-Mail als Namen an.
ALTER TABLE users RENAME COLUMN email TO name;
CREATE UNIQUE INDEX IF NOT EXISTS users_name_nocase ON users(name COLLATE NOCASE);
-- Admins dürfen Spieler verwalten (Passwort zurücksetzen, Rechte, löschen)
ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
