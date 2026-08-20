-- RosterOwl sync: identity, sessions, and one document per teacher.
--
-- The document is the same PersistedState the app already keeps in
-- localStorage and writes to backup files, stored verbatim as JSON. Keeping it
-- opaque here is deliberate: the server never needs to understand a roster to
-- hand it back, and src/lib/backup.ts already re-validates every field on the
-- way in, so nothing malformed can reach the UI whether it came from a file or
-- from this table.

CREATE TABLE users (
  id          TEXT    PRIMARY KEY,
  provider    TEXT    NOT NULL,
  -- The provider's stable account id. For Google this is the `sub` claim, which
  -- never changes; email can and does change, so it is stored for display only
  -- and is never the key we match on.
  subject     TEXT    NOT NULL,
  email       TEXT,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (provider, subject)
);

-- Only the SHA-256 of the session token is stored. A dump of this table is
-- therefore not a set of usable sessions.
CREATE TABLE sessions (
  token_hash  TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE documents (
  user_id     TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc         TEXT    NOT NULL,
  -- Monotonic. A client sends the rev it last saw; a mismatch means the other
  -- device wrote first, and the write is refused rather than merged. See
  -- worker/index.ts and src/lib/sync.svelte.ts for what happens next.
  rev         INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- Free-text label for the device that last wrote, so the conflict message can
  -- say something better than "another device".
  device      TEXT
);
