const express = require('express');
const path = require('path');

function createApp(store) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.locals.store = store;

  app.get('/api/questions', (req, res) => {
    res.json(store.read());
  });

  app.put('/api/questions', (req, res) => {
    store.write(req.body);
    res.json({ ok: true });
  });

  app.get('/api/questions/export', (req, res) => {
    res.setHeader('content-disposition', 'attachment; filename="questions.json"');
    res.setHeader('content-type', 'application/json');
    res.send(JSON.stringify(store.read(), null, 2));
  });

  return app;
}

module.exports = { createApp };
