"""The score server's SQLite database: one file for every mini game, DATA_DIR/peak.sqlite3 (with -wal and -shm next
to it while the server runs). WAL mode lets the board be read while a score is written; a busy timeout rides out
short locks.

The schema grows by numbered migrations: each runs once, in order, at start, and schema_version remembers which ran.
To add a table or column later, append (next number, SQL) to MIGRATIONS. Never edit or reorder one that has shipped:
a database that already ran it would never see the change.
"""
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS = [
    (1, """
    -- a browser that has put a score on the board: id is public, the secret only its hash (keyed, see store.py)
    CREATE TABLE players (
        id TEXT PRIMARY KEY,
        secret_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created REAL NOT NULL,
        updated REAL NOT NULL
    );
    -- the board: one row per player, their best climb
    CREATE TABLE scores (
        player_id TEXT PRIMARY KEY REFERENCES players(id),
        time_ms INTEGER NOT NULL,
        falls INTEGER NOT NULL,
        dents INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        achieved REAL NOT NULL
    );
    CREATE INDEX scores_rank ON scores (time_ms, falls, achieved);
    -- a climb from POST /run to the claim: the rolling nonce, the splits as they arrived, the verdict
    CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        prev_nonce TEXT,
        last_hash TEXT,
        last_status INTEGER,
        last_response TEXT,
        ip_hash TEXT NOT NULL,
        created REAL NOT NULL,
        t0 INTEGER NOT NULL,
        state TEXT NOT NULL,
        splits TEXT NOT NULL DEFAULT '[]',
        time_ms INTEGER,
        falls INTEGER,
        dents INTEGER,
        verdict TEXT,
        player_id TEXT,
        finished REAL,
        claimed REAL
    );
    CREATE INDEX runs_created ON runs (created);
    -- every replay that reached a verdict, kept for audits (gzipped JSON)
    CREATE TABLE replays (
        run_id TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        verdict TEXT NOT NULL,
        details TEXT,
        created REAL NOT NULL
    );
    -- the Hall of Shame: climbs that didn't add up, with what gave them away (player_id: the make-believe one
    -- the cheater was handed, so their own board still shows them on top)
    CREATE TABLE shame (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        ip_hash TEXT,
        player_id TEXT,
        name TEXT,
        claimed_ms INTEGER,
        reason TEXT NOT NULL,
        created REAL NOT NULL
    );
    """),
    (2, """
    -- house records: five slow, silly climbs, so a fresh board isn't empty and any real climb beats them. Nobody can
    -- claim them, improve them or take their names (store.py); secret_hash '!' matches no secret.
    ALTER TABLE players ADD COLUMN house INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN quip TEXT;
    INSERT INTO players (id, secret_hash, name, created, updated, house, quip) VALUES
        ('house-pi', '!', 'while(true) climb()', 0, 0, 1, 'Started at boot. Still going. Will never return.'),
        ('house-404', '!', '404: Peak Not Found', 0, 0, 1, 'Looked everywhere for the summit. It was up.'),
        ('house-56k', '!', 'Dial-up Dave', 0, 0, 1, 'Loading the next ledge… 56 falls, one per kbit.'),
        ('house-tau', '!', 'git push --force', 0, 0, 1, 'Rewrote the mountain''s history. Twice. Tau, not pi.'),
        ('house-1337', '!', 'Ctrl+Alt+Defeat', 0, 0, 1, 'Rebooted at every checkpoint. Very leet, very slow.');
    INSERT INTO scores (player_id, time_ms, falls, dents, run_id, achieved) VALUES
        ('house-pi', 194150, 3, 1, 'house', 0),
        ('house-404', 244000, 4, 4, 'house', 0),
        ('house-56k', 312000, 56, 3, 'house', 0),
        ('house-tau', 388300, 6, 2, 'house', 0),
        ('house-1337', 817000, 13, 37, 'house', 0);
    """),
    (3, """
    -- climbs shown by link only (GET /api/peak/replay/RUN_ID), never on the board: the AI climber's (ai/), say, added
    -- with peak_scores.py --showcase. The replay is checked like any other and kept in replays; the name and the
    -- numbers here are what the link shows.
    CREATE TABLE showcase (
        run_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        falls INTEGER NOT NULL,
        dents INTEGER NOT NULL,
        created REAL NOT NULL
    );
    """),
    (4, """
    -- more than one mini game (games.py): every run, score, shame and showcase belongs to a game, and everything so
    -- far was the climb's. The players are shared: a name is the same in every game. The board becomes one entry per
    -- game and player, so scores is built again with that key.
    ALTER TABLE runs ADD COLUMN game TEXT NOT NULL DEFAULT 'peak';
    ALTER TABLE shame ADD COLUMN game TEXT NOT NULL DEFAULT 'peak';
    ALTER TABLE showcase ADD COLUMN game TEXT NOT NULL DEFAULT 'peak';
    CREATE TABLE scores_by_game (
        game TEXT NOT NULL,
        player_id TEXT NOT NULL REFERENCES players(id),
        time_ms INTEGER NOT NULL,
        falls INTEGER NOT NULL,
        dents INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        achieved REAL NOT NULL,
        PRIMARY KEY (game, player_id)
    );
    INSERT INTO scores_by_game (game, player_id, time_ms, falls, dents, run_id, achieved)
        SELECT 'peak', player_id, time_ms, falls, dents, run_id, achieved FROM scores;
    DROP TABLE scores;
    ALTER TABLE scores_by_game RENAME TO scores;
    CREATE INDEX scores_rank ON scores (game, time_ms, falls, achieved);
    """),
]


class Database:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # autocommit mode: transactions are explicit (tx), so nothing stays open by accident
        self.conn = sqlite3.connect(str(self.path), timeout=5, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()      # one connection shared by the request threads, one at a time
        for pragma in ("journal_mode=WAL", "busy_timeout=5000", "foreign_keys=ON", "synchronous=NORMAL"):
            self.conn.execute(f"PRAGMA {pragma}")
        self.migrate()

    def migrate(self):
        with self.lock:
            self.conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied REAL)")
            done = {row[0] for row in self.conn.execute("SELECT version FROM schema_version")}
            for number, sql in MIGRATIONS:
                if number in done:
                    continue
                try:
                    self.conn.executescript(f"BEGIN IMMEDIATE;\n{sql}\n"
                                            f"INSERT INTO schema_version VALUES ({int(number)},"
                                            " (julianday('now') - 2440587.5) * 86400.0);\n"
                                            "COMMIT;")
                except BaseException:
                    if self.conn.in_transaction:
                        self.conn.execute("ROLLBACK")
                    raise

    @property
    def version(self):
        with self.lock:
            return self.conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]

    @contextmanager
    def tx(self):
        """A write transaction: everything inside commits together, or not at all."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def all(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    def one(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params).fetchone()

    def backup(self, target):
        """A consistent copy of the live database in one file, safe while the server runs."""
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        with self.lock, sqlite3.connect(str(target)) as copy:
            self.conn.backup(copy)
        copy.close()

    def close(self):
        with self.lock:
            self.conn.close()
