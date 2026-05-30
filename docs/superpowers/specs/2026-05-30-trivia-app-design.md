# Drinking & Thinking Trivia — Host App Design

**Date:** 2026-05-30
**Status:** Approved
**Location:** `games/trivia/app/`

---

## Overview

A host-controlled, browser-based Jeopardy-style trivia game. Host runs a local Node/Express server, opens the host view on their machine, and controls all game actions (question selection, player turns, scoring). No player devices required for MVP. Future path to contestant network view exists via the same server.

---

## Architecture

Node/Express server. Static files served from `public/`. Questions persisted to `questions.json` on disk. No build step — run `node server.js` and open a browser.

```
games/trivia/app/
├── server.js            ← Express server, API routes, serves public/
├── questions.json       ← all questions, source of truth
├── answers.txt          ← auto-generated flat file (regenerated on every save)
├── public/
│   ├── host.html        ← game host view
│   ├── display.html     ← future contestant view (stubbed)
│   ├── answers.html     ← read-only cheat sheet (phone-accessible on LAN)
│   ├── editor.html      ← question editor
│   ├── style.css        ← shared styles
│   └── app.js           ← shared JS (game state, API calls, UI logic)
└── package.json
```

---

## Data Model

`questions.json`:

```json
{
  "categories": [
    {
      "id": "video-games",
      "name": "Video Games",
      "questions": [
        { "id": "vg-1", "value": 200, "question": "...", "answer": "..." },
        { "id": "vg-2", "value": 400, "question": "...", "answer": "..." },
        { "id": "vg-3", "value": 600, "question": "...", "answer": "..." },
        { "id": "vg-4", "value": 800, "question": "...", "answer": "..." },
        { "id": "vg-5", "value": 1000, "question": "...", "answer": "..." }
      ]
    }
  ]
}
```

**Value assignment:** Each category supports up to 5 questions at values 200/400/600/800/1000. Questions are assigned values in the editor. If a category has more than 5 questions, only the 5 with assigned values appear on the board — extras are visible in the editor.

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/questions` | Load all questions |
| PUT | `/api/questions` | Save entire questions file, regenerates `answers.txt` |
| GET | `/api/questions/export` | Download `questions.json` as file |

---

## Game State (client-side)

All game state lives in memory in `app.js`. No server-side session needed for MVP.

```js
{
  mode: "classic" | "nogain",
  players: [{ id, name, score }],
  activePlayerId: string,       // highlighted — controls the board
  board: {
    categories: [...],           // selected subset for this game
    used: Set<questionId>
  },
  currentQuestion: null | {
    categoryId, questionId,
    question, answer,
    answerRevealed: bool,
    attempts: [{ playerId, correct: bool }]
  }
}
```

---

## Game Flow

### 1. Setup Screen
- Enter player names (2–8 players)
- Pick game mode: **Classic** (wrong answer deducts points) or **No Gain** (wrong answer = no change)
- Select categories for this game (checkbox list, pulled from `questions.json`)
- Pick which player goes first (sets initial `activePlayerId`)
- Start Game

### 2. Board
- Jeopardy grid: selected categories across the top, values (200–1000) down the side
- Used cells grayed out and non-clickable
- Scores bar at the bottom: one card per player, name + score
- Active player card outlined in gold
- "End Game" button always visible (top-right corner)
- "Editor" link always visible (top-left corner, opens in new tab)
- Host clicks any available cell to open the question overlay

### 3. Question Overlay
Appears full-screen over the board.

**Host sees:**
- Question text (large, centered)
- Answer text (blurred by default — host clicks to reveal)
- Optional timer: "Start Timer" button, configurable duration (30s default), visible countdown
- Player buttons — one per contestant, host clicks the player who is answering

**After player selected:**
- **Correct** / **Incorrect** buttons appear
- Correct:
  - Points added to player's score
  - Player becomes `activePlayer` (highlighted, picks next question)
  - Overlay closes, cell marked used
- Incorrect (first attempt):
  - Classic mode: points deducted from that player
  - No Gain: no change
  - Answer stays hidden
  - Player buttons reappear — host picks who answers next
- Incorrect (second attempt):
  - Same point rules apply
  - Answer auto-reveals
  - Overlay closes, cell marked used
  - `activePlayer` does not change (no one earned control)

### 4. End Game
- Triggered by "End Game" button (with a confirmation prompt — no accidental clicks)
- Final scoreboard shown, players ranked by score
- Options: Restart with same players, or Back to Setup

### 5. Editor (separate page — `editor.html`)
- List of all categories with expand/collapse
- Add / rename / delete categories
- Add / edit / delete questions within a category (question text, answer text, point value)
- Save button → PUT `/api/questions`, regenerates `answers.txt`
- No auto-save — explicit save only to avoid accidental overwrites

### 6. Answers Cheat Sheet (`answers.html`)
- Read-only page listing all categories, questions, and answers
- Accessible from any device on the same LAN at `http://<host-ip>:3000/answers.html`
- Server prints the LAN URL on startup so host can share it easily
- No game controls, purely reference

---

## Visual Design

**Palette:** Near-black background, gold/yellow accents, deep blue for board cells. Matches "Drinking & Thinking Trivia" brand.

**Board:** Dark background, gold category headers, deep blue cells with white value text. Used cells dark gray. Active player card outlined in gold.

**Question overlay:** Full-screen dark modal. Large centered question text. Answer blurred until host reveals. Clean and readable from across a table.

**Scores bar:** Fixed at bottom. Player name + score per card. Active player card in gold outline.

**Typography:** Bold sans-serif system fonts — no Google Fonts dependency.

**Animations:** Subtle fade only — cell selection and answer reveal. No other animations in MVP. (Flashy effects added later.)

**Editor:** Plain white background, functional form layout. Usability over aesthetics.

---

## Startup

```
node server.js
```

Server prints on startup:
```
Drinking & Thinking Trivia running at:
  Local:   http://localhost:3000/host.html
  Network: http://192.168.x.x:3000/answers.html  ← open on phone
```

---

## Fallback

If phone can't reach the LAN server (firewall, different network), `answers.txt` in the project root is auto-generated on every save and can be opened in Word for Ctrl+F lookup.

---

## Out of Scope (MVP)

- Real-time contestant view on player devices
- Buzz-in mechanic
- Authentication or multi-session support
- Sound effects / animations (added post-MVP)
- Importing from the original `.pptx` files (questions entered via editor)

---

## Future Path

The Express server is already in place. Adding contestant view = add `display.html` + a WebSocket broadcast from the host. Buzz-in = add a button on `display.html` that sends a WebSocket message. No rewrite needed.
