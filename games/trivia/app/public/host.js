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
    renderOverlay();
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

$('add-player').addEventListener('click', () => addPlayerRow());
$('start').addEventListener('click', startGame);
document.addEventListener('input', e => { if (e.target.classList.contains('pname')) refreshFirstPlayer(); });

(async function init() {
  data = await Api.load();
  addPlayerRow();
  addPlayerRow();
  renderCatList();
})();
