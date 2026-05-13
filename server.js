const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const sqlite3    = require('sqlite3').verbose();
const path       = require('path');

const { initDb, DB_PATH } = require('./init-db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──────────────────────────────────────────────────────────────────
const db = new sqlite3.Database(DB_PATH, err => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
  console.log(`Connected to SQLite database at ${DB_PATH}`);
});

// Promisified helpers
const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    })
  );

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/state
 * Returns current room prices and the full bidder list.
 */
app.get('/api/state', async (req, res) => {
  try {
    const [rooms, bidders] = await Promise.all([
      dbAll('SELECT id, name, price, lastUpdatedBy, updatedAt FROM rooms ORDER BY rowid'),
      dbAll('SELECT name FROM bidders ORDER BY id'),
    ]);
    res.json({ rooms, bidders: bidders.map(b => b.name) });
  } catch (err) {
    console.error('GET /api/state error:', err.message);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

/**
 * POST /api/bid
 * Body: { roomId: string, bidderName: string, amount: number }
 * Increases the target room by `amount`, distributes the cost equally across
 * the other rooms, records the bid in history, and returns the updated state.
 */
app.post('/api/bid', async (req, res) => {
  const { roomId, bidderName, amount } = req.body;

  if (!roomId || !bidderName || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid bid payload' });
  }

  try {
    const rooms = await dbAll('SELECT id, price FROM rooms ORDER BY rowid');

    if (!rooms.find(r => r.id === roomId)) {
      return res.status(404).json({ error: `Room '${roomId}' not found` });
    }

    const otherRooms      = rooms.filter(r => r.id !== roomId);
    const decreasePerRoom = amount / otherRooms.length;
    const now             = new Date().toISOString();

    // Update target room
    await dbRun(
      `UPDATE rooms SET price = price + ?, lastUpdatedBy = ?, updatedAt = ? WHERE id = ?`,
      [amount, bidderName, now, roomId]
    );

    // Distribute cost across other rooms
    for (const other of otherRooms) {
      await dbRun(
        `UPDATE rooms SET price = price - ?, updatedAt = ? WHERE id = ?`,
        [decreasePerRoom, now, other.id]
      );
    }

    // Record bid in history
    await dbRun(
      `INSERT INTO bids (roomId, bidderName, amount, timestamp) VALUES (?, ?, ?, ?)`,
      [roomId, bidderName, amount, now]
    );

    // Return updated state
    const updatedRooms = await dbAll(
      'SELECT id, name, price, lastUpdatedBy, updatedAt FROM rooms ORDER BY rowid'
    );
    res.json({ rooms: updatedRooms });
  } catch (err) {
    console.error('POST /api/bid error:', err.message);
    res.status(500).json({ error: 'Failed to place bid' });
  }
});

/**
 * POST /api/reset
 * Resets all rooms to their initial equal split ($248 each).
 */
app.post('/api/reset', async (req, res) => {
  const INITIAL_PRICE = 744.00 / 3;
  const now           = new Date().toISOString();

  try {
    await dbRun(
      `UPDATE rooms SET price = ?, lastUpdatedBy = 'NONE', updatedAt = ?`,
      [INITIAL_PRICE, now]
    );

    const rooms = await dbAll(
      'SELECT id, name, price, lastUpdatedBy, updatedAt FROM rooms ORDER BY rowid'
    );
    res.json({ rooms });
  } catch (err) {
    console.error('POST /api/reset error:', err.message);
    res.status(500).json({ error: 'Failed to reset' });
  }
});

/**
 * GET /api/history
 * Returns all bid history entries, newest first.
 */
app.get('/api/history', async (req, res) => {
  try {
    const history = await dbAll(`
      SELECT b.id, b.roomId, r.name AS roomName, b.bidderName, b.amount, b.timestamp
      FROM   bids b
      JOIN   rooms r ON r.id = b.roomId
      ORDER  BY b.timestamp DESC, b.id DESC
    `);
    res.json({ history });
  } catch (err) {
    console.error('GET /api/history error:', err.message);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
initDb(db)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Wye-River Bid server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialise database:', err.message);
    process.exit(1);
  });
