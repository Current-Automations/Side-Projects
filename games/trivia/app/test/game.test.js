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
