const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RemoteDatabase } = require('../src/remote-db');

// A stand-in connection whose stream "expires" on demand, like Turso's.
function fakeConnectionFactory() {
  const state = { opened: 0, expired: false };
  const factory = () => {
    state.opened += 1;
    const id = state.opened;
    const check = () => {
      if (state.expired && id === state.opened - 0 && state.expireId === id) {
        throw new Error('Hrana(Api("status=400, body={\\"code\\":\\"STREAM_EXPIRED\\"}"))');
      }
    };
    return {
      id,
      prepare: (sql) => ({
        get: () => { check(); return { sql, conn: id }; },
        all: () => { check(); return [{ sql, conn: id }]; },
        run: () => { check(); return { changes: 1, conn: id }; },
      }),
      exec: () => check(),
      close: () => {},
    };
  };
  return { factory, expire: () => { state.expired = true; state.expireId = state.opened; }, state };
}

test('reconnects once when the stream has expired', () => {
  const fake = fakeConnectionFactory();
  const db = new RemoteDatabase(fake.factory);
  const stmt = db.prepare('SELECT 1');
  assert.equal(stmt.get().conn, 1);
  fake.expire();
  assert.equal(stmt.get().conn, 2);
  assert.equal(fake.state.opened, 2);
});

test('does not retry other errors or half-done transactions', () => {
  const db = new RemoteDatabase(() => ({
    prepare: () => ({ get: () => { throw new Error('no such table: x'); } }),
    exec: () => {},
  }));
  assert.throws(() => db.prepare('SELECT * FROM x').get(), /no such table/);

  const fake = fakeConnectionFactory();
  const db2 = new RemoteDatabase(fake.factory);
  assert.throws(() => db2.transaction(() => { fake.expire(); db2.prepare('UPDATE t SET a = 1').run(); })(), /STREAM_EXPIRED/);
  assert.equal(fake.state.opened, 1);
});

test('rows come back with lower-case column names', () => {
  const db = new RemoteDatabase(() => ({
    prepare: () => ({
      get: () => ({ KEY: 'phone', value: '0555', _metadata: { duration: 1 } }),
      all: () => [{ KEY: 'phone', value: '0555' }],
    }),
    exec: () => {},
  }));
  assert.deepEqual(db.prepare('SELECT key, value FROM settings').get(), { key: 'phone', value: '0555' });
  assert.deepEqual(db.prepare('SELECT key, value FROM settings').all(), [{ key: 'phone', value: '0555' }]);
});
