const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'bids.db');

const INITIAL_ROOMS = [
  { id: 'main',   name: 'Main bedroom - queen bed with ensuite',       price: 248.00 },
  { id: 'second', name: 'Second bedroom - queen bed',                   price: 248.00 },
  { id: 'third',  name: 'Third bedroom - 4x single beds (two bunks)',   price: 248.00 },
];

const INITIAL_BIDDERS = ['Etern', 'Apple', 'Leon', 'Winnie', 'Norman', 'Kai'];

function initDb(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Enable WAL mode for better concurrency
      db.run('PRAGMA journal_mode=WAL');

      db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          price         REAL NOT NULL,
          lastUpdatedBy TEXT NOT NULL DEFAULT 'NONE',
          createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS bidders (
          id   INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS bids (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          roomId      TEXT NOT NULL,
          bidderName  TEXT NOT NULL,
          amount      REAL NOT NULL,
          timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (roomId) REFERENCES rooms(id)
        )
      `);

      // Seed rooms (ignore if already present)
      const roomStmt = db.prepare(`
        INSERT OR IGNORE INTO rooms (id, name, price, lastUpdatedBy)
        VALUES (?, ?, ?, 'NONE')
      `);
      INITIAL_ROOMS.forEach(r => roomStmt.run(r.id, r.name, r.price));
      roomStmt.finalize();

      // Seed bidders (ignore if already present)
      const bidderStmt = db.prepare(`INSERT OR IGNORE INTO bidders (name) VALUES (?)`);
      INITIAL_BIDDERS.forEach(name => bidderStmt.run(name));
      bidderStmt.finalize(err => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// Allow running directly: `node init-db.js`
if (require.main === module) {
  const db = new sqlite3.Database(DB_PATH, err => {
    if (err) { console.error('Failed to open database:', err.message); process.exit(1); }
    console.log(`Connected to database at ${DB_PATH}`);
  });

  initDb(db)
    .then(() => {
      console.log('Database initialised successfully.');
      db.close();
    })
    .catch(err => {
      console.error('Initialisation failed:', err.message);
      db.close();
      process.exit(1);
    });
}

module.exports = { initDb, DB_PATH };
