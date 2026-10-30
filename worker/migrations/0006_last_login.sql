-- Wann sich ein Spieler zuletzt angemeldet bzw. das Spiel geöffnet hat
ALTER TABLE users ADD COLUMN last_login INTEGER NOT NULL DEFAULT 0;
