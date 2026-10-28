-- Einstellungen, die der Admin im Spiel ändern kann
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
-- Wie viele Spieler (ohne Admins) ein Konto haben dürfen. -1 = unbegrenzt. Start: 1 weiterer Spieler.
INSERT OR IGNORE INTO settings (k, v) VALUES ('max_players', '1');
