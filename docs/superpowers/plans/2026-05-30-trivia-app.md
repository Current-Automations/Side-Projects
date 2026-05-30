# Drinking & Thinking Trivia — Host App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host-controlled, browser-based Jeopardy-style trivia game ("Drinking & Thinking Trivia") that runs from a local Node/Express server, with a question editor and a phone-accessible answers cheat sheet.

**Architecture:** Express server serves static files from `public/` and exposes three JSON API routes backed by `questions.json` on disk. Pure game logic lives in a dual-environment module (`game.js`) that runs in both Node tests and the browser. The host UI is vanilla JS with no build step.

**Tech Stack:** Node 26 (built-in `node:test` + `fetch`), Express, vanilla HTML/CSS/JS. No bundler, no front-end framework.

**Spec:** `docs/superpowers/specs/2026-05-30-trivia-app-design.md`

---

## File Structure

```
games/trivia/app/
├── package.json         ← deps (express), scripts (start, test)
├── questions.json       ← seed data, source of truth
├── answers.txt          ← auto-generated on every save (git-ignored)
├── data.js              ← store: read/write questions.json + regenerate answers.txt
├── server.js            ← createApp(store) + listen with LAN URL printout
├── public/
│   ├── game.js          ← PURE game logic (dual Node/browser export)
│   ├── app.js           ← Api client + DOM helpers (window.Api, window.el)
│   ├── host.js          ← host page controller (setup → board → overlay → end)
│   ├── editor.js        ← editor page controller
│   ├── answers.js       ← cheat-sheet renderer
│   ├── host.html
│   ├── editor.html
│   ├── answers.html
│   ├── display.html     ← future contestant view (stub)
│   └── style.css
└── test/
    ├── game.test.js     ← unit tests for game.js
    └── api.test.js      ← integration tests for server routes
```

**Responsibilities:**
- `game.js` — all scoring/turn/attempt rules. No DOM, no I/O. The only heavily-tested unit.
- `data.js` — filesystem persistence + `answers.txt` generation. Injected into `createApp` so tests use a temp file.
- `server.js` — wiring only: routes + static + startup.
- `host.js` / `editor.js` / `answers.js` — DOM controllers, verified manually in the browser.

---

## Task 1: Project scaffold + Express server boots

**Files:**
- Create: `games/trivia/app/package.json`
- Create: `games/trivia/app/server.js`
- Create: `games/trivia/app/public/host.html` (placeholder)
- Create: `games/trivia/app/test/api.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "drinking-thinking-trivia",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

- [ ] **Step 2: Install Express**

Run (from `games/trivia/app/`): `npm install`
Expected: `node_modules/` created, `express` present, no errors.

- [ ] **Step 3: Create placeholder `public/host.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Trivia</title></head>
<body><h1>Drinking &amp; Thinking Trivia</h1></body></html>
```

- [ ] **Step 4: Write `server.js` with `createApp` export**

```js
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
```

- [ ] **Step 5: Write the failing test in `test/api.test.js`**

```js
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
  assert.match(body, /Drinking & Thinking Trivia/);
});
```

- [ ] **Step 6: Run test to verify it passes**

Run (from `games/trivia/app/`): `npm test`
Expected: 1 test passing.

- [ ] **Step 7: Commit**

```bash
git add games/trivia/app/package.json games/trivia/app/server.js games/trivia/app/public/host.html games/trivia/app/test/api.test.js games/trivia/app/package-lock.json
git commit -m "feat(trivia): scaffold express server with static serving"
```

---

## Task 2: Data store + answers.txt generation

**Files:**
- Create: `games/trivia/app/data.js`
- Create: `games/trivia/app/questions.json` (seed)
- Create: `games/trivia/app/.gitignore`
- Test: `games/trivia/app/test/data.test.js`

- [ ] **Step 1: Create seed `questions.json`**

```json
{
  "categories": [
    {
      "id": "lol",
      "name": "League of Legends",
      "questions": [
        { "id": "lol-1", "value": 200, "question": "This champion is known as the \"Emperor of the Sands.\"", "answer": "Azir" },
        { "id": "lol-2", "value": 400, "question": "In lore, who is Renekton's brother?", "answer": "Nasus" },
        { "id": "lol-3", "value": 600, "question": "What does Katarina's \"Shunpo\" translate to?", "answer": "Blink Step" },
        { "id": "lol-4", "value": 800, "question": "Which champion has the quote \"The forest holds many surprises\"?", "answer": "Zyra" },
        { "id": "lol-5", "value": 1000, "question": "Who is the only champion to \"Dab\" if you emote after a kill?", "answer": "Qiyana" }
      ]
    },
    {
      "id": "cod",
      "name": "Call of Duty",
      "questions": [
        { "id": "cod-1", "value": 200, "question": "What was the 5th Call of Duty game released?", "answer": "World at War" },
        { "id": "cod-2", "value": 400, "question": "What number installment was Ghosts?", "answer": "10th" },
        { "id": "cod-3", "value": 600, "question": "In MW2, what perk removed your secondary weapon?", "answer": "One Man Army" },
        { "id": "cod-4", "value": 800, "question": "In Black Ops, how many kills were the attack dogs?", "answer": "11" },
        { "id": "cod-5", "value": 1000, "question": "What was the blackbird / advanced UAV called in Black Ops 3?", "answer": "HATR" }
      ]
    },
    {
      "id": "elden",
      "name": "Elden Ring",
      "questions": [
        { "id": "elden-1", "value": 200, "question": "Who was Malenia's mother?", "answer": "Queen Marika" },
        { "id": "elden-2", "value": 400, "question": "Who was the daughter of Rennala and Radagon?", "answer": "Ranni" },
        { "id": "elden-3", "value": 600, "question": "Who is the half-wolf son of Ranni?", "answer": "Blaidd" },
        { "id": "elden-4", "value": 800, "question": "Who was Millicent's mother?", "answer": "Malenia" },
        { "id": "elden-5", "value": 1000, "question": "Who is the merchant near the Two Fingers in Roundtable Hold?", "answer": "Enia" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
answers.txt
```

- [ ] **Step 3: Write the failing test in `test/data.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, buildAnswersText } = require('../data.js');

function tmp(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-')), name);
}

test('store.read returns parsed json', () => {
  const dataPath = tmp('q.json');
  fs.writeFileSync(dataPath, JSON.stringify({ categories: [{ id: 'a', name: 'A', questions: [] }] }));
  const store = createStore(dataPath, tmp('answers.txt'));
  assert.strictEqual(store.read().categories[0].name, 'A');
});

test('store.write persists json and regenerates answers.txt', () => {
  const dataPath = tmp('q.json');
  const answersPath = tmp('answers.txt');
  const store = createStore(dataPath, answersPath);
  store.write({ categories: [{ id: 'a', name: 'Anime', questions: [{ id: 'a-1', value: 200, question: 'Q?', answer: 'A!' }] }] });
  assert.match(fs.readFileSync(dataPath, 'utf8'), /Anime/);
  const answers = fs.readFileSync(answersPath, 'utf8');
  assert.match(answers, /== Anime ==/);
  assert.match(answers, /\[200\] Q\? -> A!/);
});

test('buildAnswersText formats every category and question', () => {
  const text = buildAnswersText({ categories: [
    { name: 'Cat', questions: [{ value: 400, question: 'Who?', answer: 'Me' }] }
  ] });
  assert.match(text, /== Cat ==/);
  assert.match(text, /\[400\] Who\? -> Me/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/data.test.js`
Expected: FAIL — `Cannot find module '../data.js'`.

- [ ] **Step 5: Write `data.js`**

```js
const fs = require('node:fs');

function buildAnswersText(data) {
  const lines = [];
  for (const cat of data.categories) {
    lines.push(`== ${cat.name} ==`);
    const sorted = [...cat.questions].sort((a, b) => a.value - b.value);
    for (const q of sorted) {
      lines.push(`[${q.value}] ${q.question} -> ${q.answer}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function createStore(dataPath, answersPath) {
  return {
    read() {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    },
    write(data) {
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
      fs.writeFileSync(answersPath, buildAnswersText(data));
    }
  };
}

module.exports = { createStore, buildAnswersText };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/data.test.js`
Expected: 3 tests passing.

- [ ] **Step 7: Commit**

```bash
git add games/trivia/app/data.js games/trivia/app/questions.json games/trivia/app/.gitignore games/trivia/app/test/data.test.js
git commit -m "feat(trivia): data store with answers.txt generation and seed questions"
```

---

## Task 3: API routes (GET / PUT / export)

**Files:**
- Modify: `games/trivia/app/server.js`
- Test: `games/trivia/app/test/api.test.js`

- [ ] **Step 1: Add failing route tests to `test/api.test.js`**

Append to the existing file:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/api.test.js`
Expected: the 3 new tests FAIL (404 / missing header); the Task 1 test still passes.

- [ ] **Step 3: Add routes to `server.js`**

Replace the body of `createApp` so it reads (full file):

```js
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
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm test`
Expected: all tests passing (Task 1 + Task 2 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add games/trivia/app/server.js games/trivia/app/test/api.test.js
git commit -m "feat(trivia): GET/PUT/export questions API routes"
```

---

## Task 4: Pure game logic module (the testable core)

**Files:**
- Create: `games/trivia/app/public/game.js`
- Test: `games/trivia/app/test/game.test.js`

This module owns ALL scoring and turn rules. `recordAttempt` returns a status string the UI reacts to:
- `'correct'` — points added, attempter becomes active player, question marked used and cleared.
- `'incorrect-continue'` — first wrong answer; question stays open, answer hidden, host picks next answerer.
- `'incorrect-final'` — second wrong answer; answer revealed, question marked used, but kept on screen until host calls `closeQuestion`. Active player unchanged.

- [ ] **Step 1: Write failing tests in `test/game.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../public/game.js');

function setup(mode = 'classic') {
  const state = G.createGame({
    mode,
    players: [{ id: 'p1', name: 'Al' }, { id: 'p2', name: 'Bo' }],
    firstPlayerId: 'p1',
    categories: [
      { id: 'c', name: 'C', questions: [{ id: 'c-1', value: 200, question: 'Q?', answer: 'A!' }] }
    ]
  });
  return state;
}

test('createGame initializes scores to 0 and sets active player', () => {
  const s = setup();
  assert.strictEqual(s.players[0].score, 0);
  assert.strictEqual(s.activePlayerId, 'p1');
  assert.deepStrictEqual(s.used, []);
  assert.strictEqual(s.currentQuestion, null);
});

test('scoreDelta: correct adds value in both modes', () => {
  assert.strictEqual(G.scoreDelta('classic', true, 200), 200);
  assert.strictEqual(G.scoreDelta('nogain', true, 200), 200);
});

test('scoreDelta: incorrect deducts in classic, zero in nogain', () => {
  assert.strictEqual(G.scoreDelta('classic', false, 200), -200);
  assert.strictEqual(G.scoreDelta('nogain', false, 200), 0);
});

test('selectQuestion populates currentQuestion hidden by default', () => {
  const s = setup();
  G.selectQuestion(s, 'c', 'c-1');
  assert.strictEqual(s.currentQuestion.value, 200);
  assert.strictEqual(s.currentQuestion.answer, 'A!');
  assert.strictEqual(s.currentQuestion.answerRevealed, false);
  assert.deepStrictEqual(s.currentQuestion.attempts, []);
});

test('revealAnswer flips the flag', () => {
  const s = setup();
  G.selectQuestion(s, 'c', 'c-1');
  G.revealAnswer(s);
  assert.strictEqual(s.currentQuestion.answerRevealed, true);
});

test('correct answer: scores, sets active player, marks used, clears question', () => {
  const s = setup();
  s.activePlayerId = 'p1';
  G.selectQuestion(s, 'c', 'c-1');
  const status = G.recordAttempt(s, 'p2', true);
  assert.strictEqual(status, 'correct');
  assert.strictEqual(s.players.find(p => p.id === 'p2').score, 200);
  assert.strictEqual(s.activePlayerId, 'p2');
  assert.deepStrictEqual(s.used, ['c-1']);
  assert.strictEqual(s.currentQuestion, null);
});

test('first wrong answer (classic): deducts, keeps question open, hidden', () => {
  const s = setup('classic');
  G.selectQuestion(s, 'c', 'c-1');
  const status = G.recordAttempt(s, 'p1', false);
  assert.strictEqual(status, 'incorrect-continue');
  assert.strictEqual(s.players.find(p => p.id === 'p1').score, -200);
  assert.strictEqual(s.currentQuestion.answerRevealed, false);
  assert.deepStrictEqual(s.used, []);
});

test('first wrong answer (nogain): no deduction', () => {
  const s = setup('nogain');
  G.selectQuestion(s, 'c', 'c-1');
  G.recordAttempt(s, 'p1', false);
  assert.strictEqual(s.players.find(p => p.id === 'p1').score, 0);
});

test('second wrong answer: reveals, marks used, keeps on screen, active unchanged', () => {
  const s = setup('classic');
  s.activePlayerId = 'p1';
  G.selectQuestion(s, 'c', 'c-1');
  G.recordAttempt(s, 'p1', false);
  const status = G.recordAttempt(s, 'p2', false);
  assert.strictEqual(status, 'incorrect-final');
  assert.strictEqual(s.currentQuestion.answerRevealed, true);
  assert.deepStrictEqual(s.used, ['c-1']);
  assert.strictEqual(s.activePlayerId, 'p1');
});

test('closeQuestion clears the current question', () => {
  const s = setup();
  G.selectQuestion(s, 'c', 'c-1');
  G.recordAttempt(s, 'p1', false);
  G.recordAttempt(s, 'p2', false);
  G.closeQuestion(s);
  assert.strictEqual(s.currentQuestion, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/game.test.js`
Expected: FAIL — `Cannot find module '../public/game.js'`.

- [ ] **Step 3: Write `public/game.js`**

```js
(function (global) {
  function createGame({ mode, players, firstPlayerId, categories }) {
    return {
      mode,
      players: players.map(p => ({ id: p.id, name: p.name, score: 0 })),
      activePlayerId: firstPlayerId,
      categories,
      used: [],
      currentQuestion: null
    };
  }

  function findQuestion(state, categoryId, questionId) {
    const cat = state.categories.find(c => c.id === categoryId);
    return cat && cat.questions.find(q => q.id === questionId);
  }

  function selectQuestion(state, categoryId, questionId) {
    const q = findQuestion(state, categoryId, questionId);
    state.currentQuestion = {
      categoryId,
      questionId,
      question: q.question,
      answer: q.answer,
      value: q.value,
      answerRevealed: false,
      attempts: []
    };
    return state;
  }

  function revealAnswer(state) {
    if (state.currentQuestion) state.currentQuestion.answerRevealed = true;
    return state;
  }

  function scoreDelta(mode, correct, value) {
    if (correct) return value;
    return mode === 'classic' ? -value : 0;
  }

  function markUsed(state, questionId) {
    if (!state.used.includes(questionId)) state.used.push(questionId);
  }

  function recordAttempt(state, playerId, correct) {
    const cq = state.currentQuestion;
    const player = state.players.find(p => p.id === playerId);
    player.score += scoreDelta(state.mode, correct, cq.value);
    cq.attempts.push({ playerId, correct });

    if (correct) {
      state.activePlayerId = playerId;
      markUsed(state, cq.questionId);
      state.currentQuestion = null;
      return 'correct';
    }

    if (cq.attempts.length >= 2) {
      cq.answerRevealed = true;
      markUsed(state, cq.questionId);
      return 'incorrect-final';
    }

    return 'incorrect-continue';
  }

  function closeQuestion(state) {
    state.currentQuestion = null;
    return state;
  }

  const api = { createGame, selectQuestion, revealAnswer, scoreDelta, recordAttempt, closeQuestion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Game = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/game.test.js`
Expected: all 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add games/trivia/app/public/game.js games/trivia/app/test/game.test.js
git commit -m "feat(trivia): pure game logic module with full unit coverage"
```

---

## Task 5: Front-end API client + DOM helpers

**Files:**
- Create: `games/trivia/app/public/app.js`

No automated test — verified by usage in later tasks.

- [ ] **Step 1: Write `public/app.js`**

```js
const Api = {
  async load() {
    const res = await fetch('/api/questions');
    return res.json();
  },
  async save(data) {
    const res = await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  }
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

window.Api = Api;
window.el = el;
```

- [ ] **Step 2: Commit**

```bash
git add games/trivia/app/public/app.js
git commit -m "feat(trivia): front-end api client and dom helper"
```

---

## Task 6: Host view — setup screen + board

**Files:**
- Modify: `games/trivia/app/public/host.html`
- Create: `games/trivia/app/public/host.js`
- Create: `games/trivia/app/public/style.css`

- [ ] **Step 1: Write `public/style.css`**

```css
:root {
  --bg: #0c0c0e;
  --gold: #f3c63d;
  --cell: #16306b;
  --cell-used: #2a2a2e;
  --text: #f5f5f5;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
}
.hidden { display: none !important; }
h1 { color: var(--gold); }

/* Setup */
.setup { max-width: 640px; margin: 40px auto; padding: 0 20px; }
.setup label { display: block; margin: 14px 0 4px; font-weight: 700; }
.setup input[type="text"] { width: 100%; padding: 8px; font-size: 16px; }
.player-row { display: flex; gap: 8px; margin-bottom: 6px; }
.cat-list label { font-weight: 400; display: flex; gap: 8px; align-items: center; }
button {
  background: var(--gold); color: #000; border: 0; border-radius: 6px;
  padding: 10px 16px; font-weight: 700; font-size: 15px; cursor: pointer;
}
button.secondary { background: #2a2a2e; color: var(--text); }

/* Board */
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; }
.topbar a { color: var(--gold); }
.board { display: grid; gap: 8px; padding: 0 16px; }
.cat-head {
  background: #000; color: var(--gold); text-align: center; padding: 14px 6px;
  font-weight: 800; text-transform: uppercase; border-radius: 6px;
}
.cell {
  background: var(--cell); color: var(--gold); font-size: 28px; font-weight: 800;
  text-align: center; padding: 22px 6px; border-radius: 6px; cursor: pointer;
  transition: opacity 0.25s ease;
}
.cell.used { background: var(--cell-used); color: var(--cell-used); cursor: default; }

/* Scores */
.scores { display: flex; gap: 10px; padding: 16px; flex-wrap: wrap; }
.score-card {
  border: 2px solid transparent; border-radius: 8px; padding: 10px 16px;
  background: #18181c; min-width: 120px; text-align: center;
}
.score-card.active { border-color: var(--gold); }
.score-card .name { font-weight: 700; }
.score-card .pts { font-size: 24px; color: var(--gold); }

/* Overlay */
.overlay {
  position: fixed; inset: 0; background: rgba(8,8,10,0.97);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px; text-align: center; animation: fade 0.25s ease;
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.overlay .q { font-size: 38px; font-weight: 800; max-width: 1000px; }
.overlay .a {
  font-size: 30px; color: var(--gold); margin-top: 24px; filter: blur(10px);
  cursor: pointer; transition: filter 0.25s ease;
}
.overlay .a.revealed { filter: none; }
.overlay .controls { margin-top: 36px; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.timer { font-size: 40px; color: var(--gold); margin-top: 16px; min-height: 48px; }
```

- [ ] **Step 2: Write `public/host.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drinking &amp; Thinking Trivia</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="setup" class="setup">
    <h1>Drinking &amp; Thinking Trivia</h1>

    <label>Players</label>
    <div id="players"></div>
    <button class="secondary" id="add-player" type="button">+ Add Player</button>

    <label>Mode</label>
    <select id="mode">
      <option value="classic">Classic (wrong answer deducts points)</option>
      <option value="nogain">No Gain (wrong answer = no change)</option>
    </select>

    <label>Categories</label>
    <div id="cat-list" class="cat-list"></div>

    <label>First player</label>
    <select id="first-player"></select>

    <p><button id="start" type="button">Start Game</button></p>
  </div>

  <div id="game" class="hidden">
    <div class="topbar">
      <a href="editor.html" target="_blank">Editor</a>
      <button class="secondary" id="end-game" type="button">End Game</button>
    </div>
    <div id="board" class="board"></div>
    <div id="scores" class="scores"></div>
  </div>

  <div id="overlay-root"></div>
  <div id="endscreen" class="hidden"></div>

  <script src="game.js"></script>
  <script src="app.js"></script>
  <script src="host.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `public/host.js` (setup + board; overlay/end stubbed for next tasks)**

```js
let data = null;
let state = null;
let playerCount = 0;

const $ = id => document.getElementById(id);

function addPlayerRow(name = '') {
  playerCount++;
  const id = 'p' + playerCount;
  const input = el('input', { type: 'text', value: name, placeholder: 'Player name', 'data-pid': id, class: 'pname' });
  $('players').appendChild(el('div', { class: 'player-row' }, [input]));
  refreshFirstPlayer();
}

function readPlayers() {
  return [...document.querySelectorAll('.pname')]
    .map(i => ({ id: i.getAttribute('data-pid'), name: i.value.trim() }))
    .filter(p => p.name.length > 0);
}

function refreshFirstPlayer() {
  const sel = $('first-player');
  const current = sel.value;
  sel.innerHTML = '';
  for (const p of readPlayers()) {
    sel.appendChild(el('option', { value: p.id, text: p.name }));
  }
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function renderCatList() {
  const root = $('cat-list');
  root.innerHTML = '';
  for (const c of data.categories) {
    root.appendChild(el('label', {}, [
      el('input', { type: 'checkbox', value: c.id, checked: 'checked' }),
      ` ${c.name} (${c.questions.length})`
    ]));
  }
}

function selectedCategories() {
  const ids = [...document.querySelectorAll('#cat-list input:checked')].map(i => i.value);
  return data.categories.filter(c => ids.includes(c.id));
}

function startGame() {
  const players = readPlayers();
  if (players.length < 2) { alert('Add at least 2 players.'); return; }
  const cats = selectedCategories();
  if (cats.length === 0) { alert('Select at least one category.'); return; }
  state = Game.createGame({
    mode: $('mode').value,
    players,
    firstPlayerId: $('first-player').value || players[0].id,
    categories: cats
  });
  $('setup').classList.add('hidden');
  $('game').classList.remove('hidden');
  renderBoard();
  renderScores();
}

const VALUES = [200, 400, 600, 800, 1000];

function renderBoard() {
  const board = $('board');
  board.style.gridTemplateColumns = `repeat(${state.categories.length}, 1fr)`;
  board.innerHTML = '';
  for (const c of state.categories) {
    board.appendChild(el('div', { class: 'cat-head', text: c.name }));
  }
  for (const value of VALUES) {
    for (const c of state.categories) {
      const q = c.questions.find(x => x.value === value);
      if (!q) { board.appendChild(el('div', { class: 'cell used' })); continue; }
      const used = state.used.includes(q.id);
      const cell = el('div', {
        class: 'cell' + (used ? ' used' : ''),
        text: used ? '' : String(value)
      });
      if (!used) cell.addEventListener('click', () => openQuestion(c.id, q.id));
      board.appendChild(cell);
    }
  }
}

function renderScores() {
  const root = $('scores');
  root.innerHTML = '';
  for (const p of state.players) {
    root.appendChild(el('div', { class: 'score-card' + (p.id === state.activePlayerId ? ' active' : '') }, [
      el('div', { class: 'name', text: p.name }),
      el('div', { class: 'pts', text: String(p.score) })
    ]));
  }
}

// Stubbed — implemented in Task 7 / 8
function openQuestion(categoryId, questionId) { console.log('open', categoryId, questionId); }

$('add-player').addEventListener('click', () => addPlayerRow());
$('start').addEventListener('click', startGame);
document.addEventListener('input', e => { if (e.target.classList.contains('pname')) refreshFirstPlayer(); });

(async function init() {
  data = await Api.load();
  addPlayerRow();
  addPlayerRow();
  renderCatList();
})();
```

- [ ] **Step 4: Manual verification**

Run (from `games/trivia/app/`): `npm start`
Open `http://localhost:3000/host.html`. Verify, using the `/verify` skill or Playwright MCP:
- Setup screen shows 2 player rows, mode dropdown, 3 category checkboxes (League of Legends, Call of Duty, Elden Ring), first-player dropdown that updates as you type names.
- Enter two names, click Start Game.
- Board renders 3 columns × 5 value rows (200–1000). Scores bar shows both players, first player's card outlined in gold.
- Clicking a cell logs `open <cat> <q>` to the browser console.

- [ ] **Step 5: Commit**

```bash
git add games/trivia/app/public/host.html games/trivia/app/public/host.js games/trivia/app/public/style.css
git commit -m "feat(trivia): host setup screen and game board"
```

---

## Task 7: Question overlay + scoring wiring

**Files:**
- Modify: `games/trivia/app/public/host.js`

Replaces the stubbed `openQuestion`. Adds overlay rendering, optional timer, player buttons, correct/incorrect flow driven by `Game.recordAttempt`.

- [ ] **Step 1: Replace the `openQuestion` stub in `host.js`**

Remove the stub line and add:

```js
let timerHandle = null;

function clearTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

function closeOverlay() {
  clearTimer();
  $('overlay-root').innerHTML = '';
}

function openQuestion(categoryId, questionId) {
  Game.selectQuestion(state, categoryId, questionId);
  renderOverlay();
}

function renderOverlay() {
  const cq = state.currentQuestion;
  if (!cq) { closeOverlay(); return; }
  const root = $('overlay-root');
  root.innerHTML = '';

  const answer = el('div', { class: 'a' + (cq.answerRevealed ? ' revealed' : ''), text: cq.answer });
  answer.addEventListener('click', () => { Game.revealAnswer(state); renderOverlay(); });

  const timerLabel = el('div', { class: 'timer' });

  const controls = el('div', { class: 'controls' });
  renderAttemptControls(controls);

  const overlay = el('div', { class: 'overlay' }, [
    el('div', { class: 'q', text: cq.question }),
    answer,
    timerLabel,
    el('div', { class: 'controls' }, [
      el('button', { class: 'secondary', text: 'Start Timer (30s)', type: 'button',
        onclick: () => startTimer(timerLabel, 30) })
    ]),
    controls
  ]);
  root.appendChild(overlay);
}

function startTimer(label, seconds) {
  clearTimer();
  let remaining = seconds;
  label.textContent = String(remaining);
  timerHandle = setInterval(() => {
    remaining--;
    label.textContent = remaining > 0 ? String(remaining) : "Time's up";
    if (remaining <= 0) clearTimer();
  }, 1000);
}

function renderAttemptControls(controls) {
  controls.innerHTML = '';
  // One button per player to pick who is answering
  for (const p of state.players) {
    controls.appendChild(el('button', {
      class: 'secondary', text: p.name, type: 'button',
      onclick: () => pickAnswerer(p.id, controls)
    }));
  }
}

function pickAnswerer(playerId, controls) {
  const player = state.players.find(p => p.id === playerId);
  controls.innerHTML = '';
  controls.appendChild(el('div', { text: `${player.name}: ` }));
  controls.appendChild(el('button', {
    text: 'Correct', type: 'button',
    onclick: () => resolveAttempt(playerId, true)
  }));
  controls.appendChild(el('button', {
    class: 'secondary', text: 'Incorrect', type: 'button',
    onclick: () => resolveAttempt(playerId, false)
  }));
}

function resolveAttempt(playerId, correct) {
  const status = Game.recordAttempt(state, playerId, correct);
  clearTimer();
  renderScores();
  renderBoard();
  if (status === 'correct') {
    closeOverlay();
  } else if (status === 'incorrect-continue') {
    renderOverlay(); // answer still hidden, player buttons reappear
  } else if (status === 'incorrect-final') {
    renderFinalOverlay();
  }
}

function renderFinalOverlay() {
  const cq = state.currentQuestion;
  const root = $('overlay-root');
  root.innerHTML = '';
  const overlay = el('div', { class: 'overlay' }, [
    el('div', { class: 'q', text: cq.question }),
    el('div', { class: 'a revealed', text: cq.answer }),
    el('div', { class: 'controls' }, [
      el('button', { text: 'Close', type: 'button', onclick: () => { Game.closeQuestion(state); closeOverlay(); } })
    ])
  ]);
  root.appendChild(overlay);
}
```

- [ ] **Step 2: Manual verification**

Run: `npm start`, open `http://localhost:3000/host.html`, start a game.
Verify with `/verify` or Playwright MCP:
- Click a cell → overlay shows question, blurred answer, Start Timer button, one button per player.
- Click the answer → it unblurs.
- Click Start Timer → counts down from 30, shows "Time's up" at 0.
- Click a player → Correct / Incorrect buttons appear.
- **Correct:** that player's score increases by the cell value, their card becomes the gold-outlined active card, overlay closes, cell is grayed out.
- **Incorrect once (Classic):** player's score drops by the value, overlay stays, answer still hidden, player buttons reappear.
- **Incorrect twice:** answer reveals, Close button appears; clicking Close grays the cell and dismisses overlay; active player unchanged.
- Switch to No Gain mode in a new game: wrong answers do not change scores.

- [ ] **Step 3: Commit**

```bash
git add games/trivia/app/public/host.js
git commit -m "feat(trivia): question overlay, optional timer, and scoring flow"
```

---

## Task 8: End game screen

**Files:**
- Modify: `games/trivia/app/public/host.js`
- Modify: `games/trivia/app/public/style.css`

- [ ] **Step 1: Add end-screen styles to `style.css`**

```css
.endscreen {
  position: fixed; inset: 0; background: var(--bg);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
}
.endscreen h1 { font-size: 44px; }
.rank { font-size: 26px; }
.rank.first { color: var(--gold); font-weight: 800; }
.endscreen .controls { display: flex; gap: 10px; margin-top: 20px; }
```

- [ ] **Step 2: Wire the End Game button in `host.js`**

Add at the bottom of `host.js` (with the other event listeners):

```js
$('end-game').addEventListener('click', () => {
  if (!confirm('End the game and show final scores?')) return;
  showEndScreen();
});

function showEndScreen() {
  closeOverlay();
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const root = $('endscreen');
  root.className = 'endscreen';
  root.innerHTML = '';
  root.appendChild(el('h1', { text: 'Final Scores' }));
  ranked.forEach((p, i) => {
    root.appendChild(el('div', { class: 'rank' + (i === 0 ? ' first' : ''), text: `${i + 1}. ${p.name} — ${p.score}` }));
  });
  root.appendChild(el('div', { class: 'controls' }, [
    el('button', { text: 'Restart (same players)', type: 'button', onclick: restartSamePlayers }),
    el('button', { class: 'secondary', text: 'Back to Setup', type: 'button', onclick: () => location.reload() })
  ]));
}

function restartSamePlayers() {
  state = Game.createGame({
    mode: state.mode,
    players: state.players.map(p => ({ id: p.id, name: p.name })),
    firstPlayerId: state.players[0].id,
    categories: state.categories
  });
  $('endscreen').className = 'hidden';
  $('endscreen').innerHTML = '';
  renderBoard();
  renderScores();
}
```

- [ ] **Step 3: Manual verification**

Run: `npm start`, play a few questions, click End Game.
Verify with `/verify` or Playwright MCP:
- Confirmation prompt appears; cancelling does nothing.
- Confirming shows ranked final scores, winner highlighted in gold.
- "Restart (same players)" returns to a fresh board with the same names, scores reset to 0, all cells available.
- "Back to Setup" reloads to the setup screen.

- [ ] **Step 4: Commit**

```bash
git add games/trivia/app/public/host.js games/trivia/app/public/style.css
git commit -m "feat(trivia): end game screen with ranking and restart"
```

---

## Task 9: Question editor

**Files:**
- Create: `games/trivia/app/public/editor.html`
- Create: `games/trivia/app/public/editor.js`

The editor uses its own plain styling (white background, functional) inline in `editor.html`, per the spec.

- [ ] **Step 1: Write `public/editor.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trivia Editor</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; }
    h1 { margin-bottom: 4px; }
    .cat { border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .cat-name { font-size: 18px; font-weight: 700; width: 60%; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
    td input, td textarea { width: 100%; box-sizing: border-box; }
    .bar { position: sticky; top: 0; background: #fff; padding: 10px 0; display: flex; gap: 10px; align-items: center; }
    button { padding: 8px 14px; cursor: pointer; }
    .danger { color: #b00; }
    .status { color: #080; }
  </style>
</head>
<body>
  <h1>Trivia Editor</h1>
  <p><a href="host.html">&larr; Back to game</a> &nbsp;|&nbsp; <a href="/api/questions/export">Download backup</a></p>
  <div class="bar">
    <button id="add-cat" type="button">+ Add Category</button>
    <button id="save" type="button">Save All</button>
    <span id="status" class="status"></span>
  </div>
  <div id="cats"></div>
  <script src="app.js"></script>
  <script src="editor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/editor.js`**

```js
let data = null;
const $ = id => document.getElementById(id);

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat';
}

function uid(prefix) {
  return prefix + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

function render() {
  const root = $('cats');
  root.innerHTML = '';
  data.categories.forEach((cat, ci) => {
    const table = el('table');
    table.appendChild(el('tr', {}, [
      el('th', { text: 'Value' }), el('th', { text: 'Question' }),
      el('th', { text: 'Answer' }), el('th', { text: '' })
    ]));
    cat.questions.forEach((q, qi) => {
      table.appendChild(el('tr', {}, [
        el('td', {}, [el('input', { type: 'number', value: q.value,
          oninput: e => { q.value = Number(e.target.value); } })]),
        el('td', {}, [el('textarea', { rows: '2', oninput: e => { q.question = e.target.value; } }, [q.question])]),
        el('td', {}, [el('textarea', { rows: '2', oninput: e => { q.answer = e.target.value; } }, [q.answer])]),
        el('td', {}, [el('button', { class: 'danger', text: 'X', type: 'button',
          onclick: () => { cat.questions.splice(qi, 1); render(); } })])
      ]));
    });

    const block = el('div', { class: 'cat' }, [
      el('input', { class: 'cat-name', type: 'text', value: cat.name,
        oninput: e => { cat.name = e.target.value; } }),
      el('button', { class: 'danger', text: 'Delete Category', type: 'button',
        onclick: () => { data.categories.splice(ci, 1); render(); } }),
      table,
      el('button', { text: '+ Add Question', type: 'button',
        onclick: () => { cat.questions.push({ id: uid(cat.id), value: 200, question: '', answer: '' }); render(); } })
    ]);
    root.appendChild(block);
  });
}

function addCategory() {
  const name = prompt('Category name?');
  if (!name) return;
  data.categories.push({ id: uid(slug(name)), name, questions: [] });
  render();
}

async function save() {
  await Api.save(data);
  $('status').textContent = 'Saved ✓';
  setTimeout(() => { $('status').textContent = ''; }, 2000);
}

$('add-cat').addEventListener('click', addCategory);
$('save').addEventListener('click', save);

(async function init() {
  data = await Api.load();
  render();
})();
```

- [ ] **Step 3: Manual verification**

Run: `npm start`, open `http://localhost:3000/editor.html`.
Verify with `/verify` or Playwright MCP:
- All 3 seed categories render with their questions in editable rows.
- Edit a question's text, change a value, click Save All → "Saved ✓" appears.
- Reload the page → the edit persisted.
- Add a category, add a question to it, save, reload → persists.
- Delete a question and a category, save, reload → persists.
- Confirm `games/trivia/app/questions.json` on disk reflects the changes and `answers.txt` was regenerated.

- [ ] **Step 4: Commit**

```bash
git add games/trivia/app/public/editor.html games/trivia/app/public/editor.js
git commit -m "feat(trivia): question editor with add/edit/delete and save"
```

---

## Task 10: Answers cheat sheet + display stub

**Files:**
- Create: `games/trivia/app/public/answers.html`
- Create: `games/trivia/app/public/answers.js`
- Create: `games/trivia/app/public/display.html`

- [ ] **Step 1: Write `public/answers.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Answers — Drinking &amp; Thinking Trivia</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 700px; margin: 16px auto; padding: 0 14px; }
    h2 { border-bottom: 2px solid #f3c63d; padding-bottom: 4px; margin-top: 24px; }
    .q { margin: 10px 0; }
    .val { font-weight: 700; color: #b8860b; }
    .ans { color: #060; font-weight: 700; }
    #filter { width: 100%; padding: 10px; font-size: 16px; position: sticky; top: 0; }
  </style>
</head>
<body>
  <input id="filter" type="text" placeholder="Filter questions/answers…">
  <div id="list"></div>
  <script src="app.js"></script>
  <script src="answers.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/answers.js`**

```js
let data = null;
const $ = id => document.getElementById(id);

function render(filter = '') {
  const f = filter.toLowerCase();
  const root = $('list');
  root.innerHTML = '';
  for (const cat of data.categories) {
    const matches = cat.questions
      .filter(q => !f || q.question.toLowerCase().includes(f) || q.answer.toLowerCase().includes(f))
      .sort((a, b) => a.value - b.value);
    if (matches.length === 0) continue;
    root.appendChild(el('h2', { text: cat.name }));
    for (const q of matches) {
      root.appendChild(el('div', { class: 'q' }, [
        el('span', { class: 'val', text: `[${q.value}] ` }),
        el('span', { text: q.question + '  →  ' }),
        el('span', { class: 'ans', text: q.answer })
      ]));
    }
  }
}

$('filter').addEventListener('input', e => render(e.target.value));

(async function init() {
  data = await Api.load();
  render();
})();
```

- [ ] **Step 3: Write `public/display.html` (stub for future contestant view)**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Contestant View</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="setup">
    <h1>Contestant View</h1>
    <p>Coming soon. This screen will mirror the board for players on their own devices.</p>
  </div>
</body>
</html>
```

- [ ] **Step 4: Manual verification**

Run: `npm start`.
- Open `http://localhost:3000/answers.html` → all categories and Q→A pairs listed; typing in the filter narrows results live (e.g. "Azir" shows only that row).
- Open `http://localhost:3000/display.html` → shows the "Coming soon" placeholder.

- [ ] **Step 5: Commit**

```bash
git add games/trivia/app/public/answers.html games/trivia/app/public/answers.js games/trivia/app/public/display.html
git commit -m "feat(trivia): phone-friendly answers cheat sheet and display stub"
```

---

## Task 11: Startup with LAN URL printout

**Files:**
- Modify: `games/trivia/app/server.js`

- [ ] **Step 1: Add the run block to `server.js`**

Append below `module.exports`:

```js
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
```

- [ ] **Step 2: Manual verification**

Run (from `games/trivia/app/`): `npm start`
Expected console output: three URLs printed, the Answers line showing a `192.168.x.x` (or similar LAN) address.
On a phone connected to the same WiFi, open the printed Answers URL and confirm the cheat sheet loads. (If it doesn't load, the Windows Firewall prompt for Node likely needs "Allow"; the `answers.txt` fallback exists regardless.)

- [ ] **Step 3: Run the full test suite once more**

Run: `npm test`
Expected: all tests (Task 1 + 2 + 3 + 4) passing.

- [ ] **Step 4: Commit**

```bash
git add games/trivia/app/server.js
git commit -m "feat(trivia): print local and LAN urls on startup"
```

---

## Self-Review

**Spec coverage:**
- Data model + file structure → Tasks 1, 2 ✓
- API endpoints (GET/PUT/export) → Task 3 ✓
- Game state shape → Task 4 (`createGame`) ✓
- Setup screen (names, mode, category select, first player) → Task 6 ✓
- Board with used cells + scores bar + active player highlight → Task 6 ✓
- Question overlay, blurred answer reveal, optional timer, player buttons → Task 7 ✓
- Correct / incorrect-continue / incorrect-final flow, Classic vs No Gain → Tasks 4 + 7 ✓
- Active player persists after correct answer → Task 4 (`recordAttempt` sets `activePlayerId`) + Task 6/8 render ✓
- End game screen with ranking + restart → Task 8 ✓
- Editor (add/edit/delete categories & questions, save) → Task 9 ✓
- Answers cheat sheet (LAN-accessible, filterable) → Task 10 ✓
- `answers.txt` fallback regenerated on save → Task 2 ✓
- display.html stub → Task 10 ✓
- LAN URL printout on startup → Task 11 ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The `openQuestion` stub in Task 6 is explicitly replaced in Task 7. ✓

**Type consistency:** Game API names (`createGame`, `selectQuestion`, `revealAnswer`, `scoreDelta`, `recordAttempt`, `closeQuestion`) match between `game.js` (Task 4), its tests (Task 4), and `host.js` callers (Tasks 6–8). State fields (`mode`, `players`, `activePlayerId`, `categories`, `used`, `currentQuestion`) are consistent across tasks. `Api.load` / `Api.save` match between `app.js` (Task 5) and consumers (Tasks 6, 9, 10). ✓
