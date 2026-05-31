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
