-- Gesperrte Spieler können sich nicht mehr anmelden
ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
-- Schlüssel für das verschlüsselte Spiel (bekommt nur, wer angemeldet und nicht gesperrt ist)
INSERT OR IGNORE INTO settings (k, v) VALUES ('game_key', lower(hex(randomblob(32))));
