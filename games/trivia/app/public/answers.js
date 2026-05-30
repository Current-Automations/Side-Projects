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
