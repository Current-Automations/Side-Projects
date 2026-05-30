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
