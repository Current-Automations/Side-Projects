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
