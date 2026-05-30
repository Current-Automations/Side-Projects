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
