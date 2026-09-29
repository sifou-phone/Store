/**
 * Wraps a remote libSQL (Turso) connection so it survives expired streams.
 *
 * Turso closes an HTTP stream after a few seconds of inactivity; the libsql
 * client keeps using the old stream and then fails on every query. This
 * wrapper opens a fresh connection and retries once when that happens.
 * Statements are prepared lazily per connection and cached by SQL text, so
 * module-level prepared statements keep working after a reconnect.
 */
const RECONNECT_ERRORS = /STREAM_EXPIRED|stream (has )?expired|stream not found|CursorClosed|Hrana\(Http|connection (reset|closed)|error sending request|broken pipe/i;

// The remote libsql client upper-cases SQL keywords, column names included:
// `CREATE TABLE settings (key ...)` becomes a column named KEY, and every row
// then comes back as { KEY: ... }. All our column names are lower case, so
// fold them back (and drop the client's _metadata field).
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '_metadata') continue;
    out[/^[A-Z_]+$/.test(k) ? k.toLowerCase() : k] = v;
  }
  return out;
}

function isReconnectable(err) {
  return RECONNECT_ERRORS.test(String(err && err.message));
}

class RemoteDatabase {
  constructor(connect) {
    this.connect = connect;
    this.conn = connect();
    this.generation = 0;
    this.inTransaction = false;
    this.statements = new Map();
  }

  reconnect() {
    try {
      if (this.conn && typeof this.conn.close === 'function') this.conn.close();
    } catch {
      /* the old stream is already gone */
    }
    this.conn = this.connect();
    this.generation += 1;
  }

  withRetry(fn) {
    try {
      return fn();
    } catch (err) {
      // Inside a transaction the work so far lives on the old stream; retrying
      // would run half a transaction, so let the caller see the error.
      if (this.inTransaction || !isReconnectable(err)) throw err;
      console.warn(`[turso] reconnecting after: ${err.message}`);
      this.reconnect();
      return fn();
    }
  }

  exec(sql) {
    return this.withRetry(() => this.conn.exec(sql));
  }

  prepare(sql) {
    let entry = this.statements.get(sql);
    if (!entry) {
      entry = { stmt: null, generation: -1 };
      this.statements.set(sql, entry);
    }
    const current = () => {
      if (!entry.stmt || entry.generation !== this.generation) {
        entry.stmt = this.conn.prepare(sql);
        entry.generation = this.generation;
      }
      return entry.stmt;
    };
    return {
      get: (...args) => normalizeRow(this.withRetry(() => current().get(...args))),
      all: (...args) => this.withRetry(() => current().all(...args)).map(normalizeRow),
      run: (...args) => this.withRetry(() => current().run(...args)),
    };
  }

  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      this.inTransaction = true;
      try {
        const result = fn(...args);
        this.conn.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          this.conn.exec('ROLLBACK');
        } catch {
          /* the stream may be gone; Turso discards the transaction with it */
        }
        throw err;
      } finally {
        this.inTransaction = false;
      }
    };
  }
}

module.exports = { RemoteDatabase, isReconnectable, normalizeRow };
