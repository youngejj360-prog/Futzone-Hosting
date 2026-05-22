// db.js
const Database = require("better-sqlite3");
const db = new Database("./futzone.sqlite");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS vouches (
  user_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS afk (
  user_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  since INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_teams (
  match_id INTEGER NOT NULL,
  team TEXT NOT NULL,
  PRIMARY KEY (match_id, team)
);



CREATE TABLE IF NOT EXISTS predictions (
  match_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  pick TEXT NOT NULL,
  bet TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
`);

module.exports = db;