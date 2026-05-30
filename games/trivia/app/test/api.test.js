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
