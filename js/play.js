// StudyTools PLAY - Flashcard Battle
// 30-second flashcard game with streak multipliers, daily free limits and a local leaderboard.

(function () {
  'use strict';

  var ROUND_SECONDS = 30;
  var POINTS_CORRECT = 10;
  var POINTS_WRONG = -5;
  var STREAK_FOR_MULTIPLIER = 3;
  var STREAK_MULTIPLIER = 2;
  var LIMIT_MESSAGE = 'You\u2019ve reached your daily PLAY limit. 87% of top students play unlimited. Upgrade to Premium for $3.99/month';

  var DEMO_DECK = {
    name: 'Demo deck: study science',
    cards: [
      { front: 'What is active recall?', back: 'Retrieving information from memory instead of rereading it' },
      { front: 'What is spaced repetition?', back: 'Reviewing material at growing intervals over time' },
      { front: 'What does the Pomodoro Technique use?', back: '25-minute focus blocks followed by short breaks' },
      { front: 'What is interleaving?', back: 'Mixing different topics or problem types in one session' },
      { front: 'What is the forgetting curve?', back: 'How quickly memory fades without review' },
      { front: 'What is elaboration?', back: 'Explaining how and why an idea works in your own words' },
      { front: 'What is the testing effect?', back: 'Practice tests improve retention more than extra reading' },
      { front: 'What is dual coding?', back: 'Combining words with diagrams or images to learn' },
      { front: 'What is a retrieval cue?', back: 'A hint that helps you pull a memory back into mind' },
      { front: 'Why is sleep important for studying?', back: 'Memories are consolidated during sleep' },
      { front: 'What is metacognition?', back: 'Thinking about how well you actually know something' },
      { front: 'What is chunking?', back: 'Grouping small items into larger meaningful units' }
    ]
  };

  var FAKE_PLAYERS = ['NovaStudies', 'MaxRecall', 'quietlibrary', 'Deniz.exe', 'polly_notes'];

  var state = {
    deck: null,
    card: null,
    score: 0,
    streak: 0,
    correct: 0,
    wrong: 0,
    timeLeft: ROUND_SECONDS,
    timer: null,
    locked: false,
    running: false
  };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* storage unavailable, scores stay in memory only */
    }
  }

  function isPremium() {
    return !!(window.PremiumLimits && window.PremiumLimits.isUserPremium());
  }

  function gamesLeft() {
    if (isPremium()) return Infinity;
    if (!window.PremiumLimits) return Infinity;
    return window.PremiumLimits.getRemainingUsage('playGames');
  }

  function isValidCard(card) {
    return card && typeof card.front === 'string' && typeof card.back === 'string' &&
      card.front.trim() && card.back.trim();
  }

  // Decks saved by the Flashcard Maker, in either supported shape.
  function loadUserDecks() {
    var decks = [];
    var named = readJSON('studytools_flashcard_decks', null);

    if (Array.isArray(named)) {
      named.forEach(function (deck, index) {
        var cards = (deck && deck.cards ? deck.cards : []).filter(isValidCard);
        if (cards.length) {
          decks.push({ name: (deck && deck.name) || ('My deck ' + (index + 1)), cards: cards });
        }
      });
    }

    var flat = readJSON('studytools_flashcard_deck', null);
    if (Array.isArray(flat)) {
      var cards = flat.filter(isValidCard);
      if (cards.length) decks.push({ name: 'My flashcards', cards: cards });
    }

    return decks;
  }

  function availableDecks() {
    return loadUserDecks().concat([DEMO_DECK]);
  }

  function renderDeckOptions() {
    var decks = availableDecks();
    el.deckSelect.innerHTML = '';
    decks.forEach(function (deck, index) {
      var option = document.createElement('option');
      option.value = String(index);
      option.textContent = deck.name + ' (' + deck.cards.length + ' cards)';
      el.deckSelect.appendChild(option);
    });
    return decks;
  }

  function updateGamesLeftBadge() {
    if (isPremium()) {
      el.gamesLeft.textContent = 'Pro \u2014 unlimited games';
      return;
    }
    var left = gamesLeft();
    el.gamesLeft.textContent = left === 1 ? '1 free game left today' : left + ' free games left today';
  }

  function showPanel(name) {
    ['start', 'game', 'result'].forEach(function (panel) {
      el['panel' + panel.charAt(0).toUpperCase() + panel.slice(1)].classList.toggle('active', panel === name);
    });
  }

  function shuffle(items) {
    var copy = items.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function multiplier() {
    return state.streak >= STREAK_FOR_MULTIPLIER ? STREAK_MULTIPLIER : 1;
  }

  function updateHud() {
    el.hudTime.textContent = String(state.timeLeft);
    el.hudScore.textContent = String(state.score);
    el.hudStreak.textContent = String(state.streak);
    el.hudMultiplier.textContent = 'x' + multiplier();
    el.timerFill.style.width = (state.timeLeft / ROUND_SECONDS) * 100 + '%';
  }

  function buildOptions(card) {
    var others = state.deck.cards
      .filter(function (item) { return item.back !== card.back; })
      .map(function (item) { return item.back; });
    return shuffle([card.back].concat(shuffle(others).slice(0, 3)));
  }

  function nextCard() {
    state.locked = false;
    var pool = state.deck.cards.filter(function (item) { return item !== state.card; });
    state.card = shuffle(pool.length ? pool : state.deck.cards)[0];
    el.question.textContent = state.card.front;
    el.answers.innerHTML = '';

    buildOptions(state.card).forEach(function (text) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer';
      button.textContent = text;
      button.addEventListener('click', function () { answer(button, text); });
      el.answers.appendChild(button);
    });
  }

  function floatPoints(target, text, colorVar) {
    var floater = document.createElement('span');
    floater.className = 'floater';
    floater.textContent = text;
    floater.style.color = colorVar;
    floater.style.left = '50%';
    floater.style.transform = 'translateX(-50%)';
    target.style.position = 'relative';
    target.appendChild(floater);
    setTimeout(function () { floater.remove(); }, 800);
  }

  function answer(button, text) {
    if (state.locked || !state.running) return;
    state.locked = true;

    var isCorrect = text === state.card.back;

    if (isCorrect) {
      state.streak++;
      state.correct++;
      var gained = POINTS_CORRECT * multiplier();
      state.score += gained;
      button.classList.add('correct');
      floatPoints(el.question, '+' + gained, 'var(--neon)');
    } else {
      state.streak = 0;
      state.wrong++;
      state.score += POINTS_WRONG;
      button.classList.add('wrong');
      floatPoints(el.question, String(POINTS_WRONG), 'var(--pink)');
      Array.prototype.forEach.call(el.answers.children, function (option) {
        if (option.textContent === state.card.back) option.classList.add('correct');
      });
    }

    updateHud();
    setTimeout(function () { if (state.running) nextCard(); }, 420);
  }

  function startGame() {
    var decks = availableDecks();
    var deck = decks[Number(el.deckSelect.value) || 0] || DEMO_DECK;

    if (deck.cards.length < 2) {
      window.alert('This deck needs at least 2 cards to play. Add more cards in the Flashcard Maker.');
      return;
    }

    if (!isPremium() && window.PremiumLimits && window.PremiumLimits.hasReachedLimit('playGames')) {
      window.PremiumLimits.showPremiumModal(LIMIT_MESSAGE);
      return;
    }

    if (window.PremiumLimits) window.PremiumLimits.incrementUsage('playGames');
    updateGamesLeftBadge();

    state.deck = deck;
    state.card = null;
    state.score = 0;
    state.streak = 0;
    state.correct = 0;
    state.wrong = 0;
    state.timeLeft = ROUND_SECONDS;
    state.running = true;

    showPanel('game');
    updateHud();
    nextCard();

    state.timer = setInterval(function () {
      state.timeLeft--;
      updateHud();
      if (state.timeLeft <= 0) endGame();
    }, 1000);

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'play_battle_start', { deck: deck.name });
    }
  }

  function endGame() {
    clearInterval(state.timer);
    state.running = false;

    var accuracy = state.correct + state.wrong
      ? Math.round((state.correct / (state.correct + state.wrong)) * 100)
      : 0;

    saveScore(state.score);
    el.resultScore.textContent = String(state.score);
    el.resultMeta.textContent = state.correct + ' correct, ' + state.wrong + ' missed, ' + accuracy + '% accuracy';
    showPanel('result');
    renderLeaderboard();

    if (!isPremium() && window.PremiumLimits && window.PremiumLimits.hasReachedLimit('playGames')) {
      el.againBtn.disabled = true;
      el.againBtn.textContent = 'Daily limit reached';
    }

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'play_battle_end', { score: state.score, accuracy: accuracy });
    }
  }

  // Leaderboard: the player's best score today against five recurring rivals.
  function todayKey() {
    return new Date().toDateString();
  }

  function saveScore(score) {
    var scores = readJSON('studytools_play_scores', {});
    var today = todayKey();
    if (!scores[today] || score > scores[today]) {
      scores[today] = score;
      writeJSON('studytools_play_scores', scores);
    }
  }

  function bestScoreToday() {
    var scores = readJSON('studytools_play_scores', {});
    return scores[todayKey()] || 0;
  }

  // Deterministic per-day rival scores so the board is stable within a day.
  function rivalScores() {
    var seed = todayKey().split('').reduce(function (sum, char) { return sum + char.charCodeAt(0); }, 0);
    return FAKE_PLAYERS.map(function (name, index) {
      var value = ((seed * (index + 7)) % 23) * 10 + 90 + index * 15;
      return { name: name, score: value, you: false };
    });
  }

  function renderLeaderboard() {
    var rows = rivalScores().concat([{ name: 'You', score: bestScoreToday(), you: true }]);
    rows.sort(function (a, b) { return b.score - a.score; });

    el.boardRows.innerHTML = '';
    rows.forEach(function (row, index) {
      var div = document.createElement('div');
      div.className = 'board-row' + (row.you ? ' you' : '');
      div.innerHTML = '<span class="board-rank">#' + (index + 1) + '</span>' +
        '<span>' + row.name + '</span>' +
        '<span class="board-score">' + row.score + '</span>';
      el.boardRows.appendChild(div);
    });

    el.boardDeck.textContent = 'Best score today';
  }

  function init() {
    el = {
      deckSelect: $('deck-select'),
      startBtn: $('start-btn'),
      againBtn: $('again-btn'),
      gamesLeft: $('games-left'),
      panelStart: $('panel-start'),
      panelGame: $('panel-game'),
      panelResult: $('panel-result'),
      hudTime: $('hud-time'),
      hudScore: $('hud-score'),
      hudStreak: $('hud-streak'),
      hudMultiplier: $('hud-multiplier'),
      timerFill: $('timer-fill'),
      question: $('question'),
      answers: $('answers'),
      resultScore: $('result-score'),
      resultMeta: $('result-meta'),
      boardRows: $('board-rows'),
      boardDeck: $('board-deck')
    };

    if (!el.deckSelect) return;

    renderDeckOptions();
    updateGamesLeftBadge();
    renderLeaderboard();

    el.startBtn.addEventListener('click', startGame);
    el.againBtn.addEventListener('click', function () {
      showPanel('start');
      renderDeckOptions();
      updateGamesLeftBadge();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
