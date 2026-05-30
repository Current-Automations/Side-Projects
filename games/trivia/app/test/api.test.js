const { test } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server.js');

test('server serves host.html at root', async () => {
  const app = createApp({ read: () => ({ categories: [] }), write: () => {} });
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/host.html`);
  const body = await res.text();
  server.close();
  assert.strictEqual(res.status, 200);
  assert.match(body, /Drinking[\s\S]*?Thinking Trivia/);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../data.js');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-api-'));
  const dataPath = path.join(dir, 'q.json');
  fs.writeFileSync(dataPath, JSON.stringify({ categories: [{ id: 'a', name: 'A', questions: [] }] }));
  return createStore(dataPath, path.join(dir, 'answers.txt'));
}

test('GET /api/questions returns stored data', async () => {
  const app = createApp(freshStore());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/api/questions`);
  const body = await res.json();
  server.close();
  assert.strictEqual(body.categories[0].id, 'a');
});

test('PUT /api/questions persists new data', async () => {
  const store = freshStore();
  const app = createApp(store);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/api/questions`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ categories: [{ id: 'b', name: 'B', questions: [] }] })
  });
  server.close();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(store.read().categories[0].id, 'b');
});

test('GET /api/questions/export sets download header', async () => {
  const app = createApp(freshStore());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/api/questions/export`);
  await res.text();
  server.close();
  assert.match(res.headers.get('content-disposition'), /attachment/);
});
