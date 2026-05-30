const express = require('express');
const path = require('path');

function createApp(store) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.locals.store = store;
  return app;
}

module.exports = { createApp };
