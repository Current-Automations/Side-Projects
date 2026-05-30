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
