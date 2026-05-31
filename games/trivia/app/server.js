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

if (require.main === module) {
  const path = require('path');
  const os = require('os');
  const { createStore } = require('./data.js');
  const store = createStore(
    path.join(__dirname, 'questions.json'),
    path.join(__dirname, 'answers.txt')
  );
  const PORT = process.env.PORT || 3000;
  createApp(store).listen(PORT, () => {
    const nets = os.networkInterfaces();
    let lan = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) lan = net.address;
      }
    }
    console.log('\nDrinking & Thinking Trivia running at:');
    console.log(`  Host:    http://localhost:${PORT}/host.html`);
    console.log(`  Answers: http://${lan}:${PORT}/answers.html   <- open on your phone`);
    console.log(`  Editor:  http://localhost:${PORT}/editor.html\n`);
  });
}
