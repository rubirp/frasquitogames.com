/*
  Play panel, routing and card previews for the home page.

  Routes live in the hash so the site stays a single page:
    #home            the grid
    #game/<slug>     the play panel for that game (nothing loads until Play is pressed)
    #about           scrolls to the About section

  The games come from src/content/games, serialised by pages/index.astro into #games-data.
*/
const GAMES = JSON.parse(document.getElementById('games-data').textContent);

(function () {
  'use strict';

  const RVM_SCRIPT = 'https://cdn.rvmplayer.org/rvmplayer.cpc6128.min.js';
  const EXTERNAL_ICON = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const $ = (sel) => document.querySelector(sel);
  const bySlug = Object.fromEntries(GAMES.map((g) => [g.slug, g]));

  const panel = $('#game-panel');
  const displayer = $('#game-displayer');
  const mount = $('#game-mount');
  const loader = $('#game-loader');
  const note = $('#player-note');
  const poster = $('#player-poster');
  const startButton = $('#player-start');
  const stopButton = $('#panel-stop');
  const gamesHeading = $('#games-title');
  const cards = Array.from(document.querySelectorAll('.game-card'));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canHover = window.matchMedia('(hover: hover)');

  let current = null;       // slug of the game whose panel is open
  let running = false;      // true once Play was pressed and the game is mounted
  let pendingPlay = null;   // slug the visitor just pressed Play on (card click)
  let runToken = 0;         // invalidates a late emulator load after Stop
  let loaderTimer = 0;
  let rvmReady = null;
  let quietFocus = false;

  const cardFor = (slug) => cards.find((c) => c.dataset.name === slug);

  /* ---------- routing: #home, #game/<slug>, #about ---------- */
  function readRoute() {
    let hash = location.hash.replace(/^#/, '');
    try { hash = decodeURIComponent(hash); } catch (e) { /* keep raw */ }
    const m = hash.match(/^game\/([a-z0-9-]+)$/);
    if (m && bySlug[m[1]]) return { name: 'game', slug: m[1] };
    if (hash === 'about') return { name: 'about' };
    return { name: 'home' };
  }

  function onRoute(isFirstLoad) {
    const route = readRoute();

    if (route.name === 'game') {
      const play = pendingPlay === route.slug;   // a card was pressed: start straight away
      pendingPlay = null;
      if (current !== route.slug) openPanel(route.slug, play, isFirstLoad === true);
      else if (play && !running) startGame();
      window.scrollTo(0, 0);
    } else if (route.name === 'home') {
      pendingPlay = null;
      if (current) closePanel();
      window.scrollTo(0, 0);
    } else {
      pendingPlay = null;
      // #about only scrolls. A game that is running keeps running until it is stopped.
      $('#about').scrollIntoView();
    }

    document.querySelectorAll('[data-nav]').forEach((link) => {
      const active = (link.dataset.nav === 'about') === (route.name === 'about');
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }

  /* ---------- the card-to-player move ---------- */
  function withTransition(fromEl, getToEl, update, skip) {
    if (skip || reduceMotion.matches || typeof document.startViewTransition !== 'function') { update(); return; }
    let done = false;
    let toEl = null;
    const run = () => {
      if (done) return;
      done = true;
      if (fromEl) fromEl.style.viewTransitionName = '';
      update();
      toEl = getToEl ? getToEl() : null;
      if (toEl) toEl.style.viewTransitionName = 'stage';
    };
    const clear = () => { if (toEl) toEl.style.viewTransitionName = ''; };

    if (fromEl) fromEl.style.viewTransitionName = 'stage';
    let vt;
    try { vt = document.startViewTransition(run); } catch (e) { run(); clear(); return; }
    // If the browser never takes its snapshot (a throttled or background tab), do not keep the visitor waiting.
    const guard = setTimeout(() => {
      if (done) return;
      run(); clear();
      try { vt.skipTransition(); } catch (e) { /* ignore */ }
    }, 250);
    vt.ready.catch(() => {});
    vt.finished.then(clear, clear).then(() => clearTimeout(guard));
  }

  /* ---------- panel ---------- */
  function fillPanel(game) {
    const title = $('#panel-title');
    title.textContent = game.title;
    if (game.titleLang) title.lang = game.titleLang; else title.removeAttribute('lang');
    $('#panel-genre').textContent = game.categories;

    poster.src = game.thumbnailUrl;
    $('#player-start-label').textContent = 'Play ' + game.title;
    displayer.classList.toggle('is-portrait', game.orientation === 'portrait');

    const titleNote = $('#panel-title-note');
    titleNote.hidden = !game.titleNote;
    titleNote.textContent = game.titleNote || '';
    $('#panel-description').textContent = game.description;

    const facts = [
      ['Why it exists', game.why],
      ['Made with', game.technology],
      ['Released', game.released],
      [game.platforms.includes(',') ? 'Platforms' : 'Platform', game.platforms]
    ];
    if (game.result) facts.push(['Result', game.result]);

    const dl = $('#panel-facts');
    dl.replaceChildren();
    facts.forEach(([label, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      dl.append(row);
    });

    const links = $('#panel-links');
    links.replaceChildren();
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = game.pageUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = game.pageLabel + ' ';
    a.insertAdjacentHTML('beforeend', EXTERNAL_ICON);
    li.append(a);
    links.append(li);
  }

  function markCards(slug) {
    cards.forEach((card) => {
      const selected = card.dataset.name === slug;
      card.classList.toggle('selected-card', selected);
      if (selected) card.setAttribute('aria-current', 'true'); else card.removeAttribute('aria-current');
    });
  }

  function openPanel(slug, play, isFirstLoad) {
    const game = bySlug[slug];
    const card = cardFor(slug);
    stopAllPreviews();

    withTransition(card.querySelector('.card-media'), () => displayer, () => {
      teardownPlayer();
      current = slug;
      fillPanel(game);
      panel.hidden = false;
      document.body.classList.add('is-playing');
      gamesHeading.classList.remove('visually-hidden');
      gamesHeading.textContent = 'All games';
      markCards(slug);
      if (play) startGame();
      window.scrollTo(0, 0);
      if (!isFirstLoad) panel.focus({ preventScroll: true });
    }, isFirstLoad);
  }

  function closePanel() {
    const slug = current;
    const card = cardFor(slug);

    withTransition(displayer, () => card.querySelector('.card-media'), () => {
      teardownPlayer();
      current = null;
      panel.hidden = true;
      document.body.classList.remove('is-playing');
      gamesHeading.classList.add('visually-hidden');
      gamesHeading.textContent = 'Games';
      markCards(null);
      window.scrollTo(0, 0);
      quietFocus = true;                      // hand focus back without starting that card's preview
      card.focus({ preventScroll: true });
      quietFocus = false;
    });
  }

  /* ---------- player: nothing is loaded before this runs ---------- */
  function setRunning(value) {
    running = value;
    startButton.hidden = value;
    $('#panel-stop-label').textContent = value ? 'Stop the game' : 'Close';
  }

  function showLoader(game) {
    $('#game-loader-label').textContent = 'Loading ' + game.title;
    loader.hidden = false;
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(hideLoader, 12000);   // never leave the cover up for good
  }
  function hideLoader() { clearTimeout(loaderTimer); loader.hidden = true; }

  function showNote(game, message) {
    hideLoader();
    note.replaceChildren();
    const p = document.createElement('p');
    p.textContent = message;
    const a = document.createElement('a');
    a.href = game.pageUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = game.pageLabel;
    note.append(p, a);
    note.hidden = false;
  }

  function startGame() {
    const game = bySlug[current];
    if (!game || running) return;
    setRunning(true);
    note.hidden = true;
    showLoader(game);

    if (game.rvmUrl) {
      startEmulator(game);
    } else {
      const iframe = document.createElement('iframe');
      iframe.id = 'game-iframe';
      iframe.title = game.title;
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
      iframe.addEventListener('load', hideLoader);
      iframe.src = game.iframeUrl;
      mount.append(iframe);
    }
  }

  function loadEmulatorScript() {
    if (typeof window.rvmPlayer_cpc6128 === 'function') return Promise.resolve();
    if (!rvmReady) {
      rvmReady = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = RVM_SCRIPT;
        script.onload = () => resolve();
        script.onerror = () => { rvmReady = null; script.remove(); reject(new Error('emulator script failed')); };
        document.head.append(script);
      });
    }
    return rvmReady;
  }

  function startEmulator(game) {
    const token = ++runToken;
    const box = document.createElement('div');
    box.id = 'RVMPlayer';
    // The emulator only starts on its own "Click to play" screen; remember that it did.
    box.addEventListener('pointerdown', () => { box.dataset.started = 'true'; }, { once: true });
    mount.append(box);

    loadEmulatorScript().then(() => {
      if (token !== runToken) return;                       // stopped while the script was loading
      if (typeof window.rvmPlayer_cpc6128 !== 'function') throw new Error('emulator not available');
      const seen = new MutationObserver(() => { hideLoader(); seen.disconnect(); });
      seen.observe(box, { childList: true });
      const result = window.rvmPlayer_cpc6128(box, {
        disk: { type: 'dsk', url: game.rvmUrl },
        command: game.rvmCommand + '\n',
        warpFrames: 20 * 50
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }).catch(() => {
      if (token !== runToken) return;
      showNote(game, 'The Amstrad emulator could not start here. The game is still available from the contest page.');
    });
  }

  function teardownPlayer() {
    runToken++;
    hideLoader();
    note.hidden = true;
    // Ask a running emulator to halt (its first bar control) before dropping it.
    // Before it has started that control throws, so it is left alone.
    const rvmStop = mount.querySelector('#RVMPlayer[data-started] .rvmContainer .rvmLeft a');
    if (rvmStop) { try { rvmStop.click(); } catch (e) { /* ignore */ } }
    const iframe = mount.querySelector('iframe');
    if (iframe) iframe.src = 'about:blank';
    mount.replaceChildren();
    setRunning(false);
  }

  /* ---------- card video preview: an enhancement for hover and keyboard focus ---------- */
  const previews = new Map();

  function startPreview(card) {
    if (reduceMotion.matches || running || previews.has(card) || card.classList.contains('selected-card')) return;
    const state = { video: null, timer: 0 };
    previews.set(card, state);
    state.timer = setTimeout(() => {
      const video = document.createElement('video');
      video.className = 'card-video';
      video.muted = true; video.loop = true; video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      video.addEventListener('playing', () => video.classList.add('is-on'), { once: true });
      video.src = card.dataset.video;                       // the source is only set now
      card.querySelector('.card-media').append(video);
      state.video = video;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }, 140);
  }

  function stopPreview(card) {
    const state = previews.get(card);
    if (!state) return;
    clearTimeout(state.timer);
    if (state.video) {
      state.video.pause();
      state.video.removeAttribute('src');
      state.video.load();
      state.video.remove();
    }
    previews.delete(card);
  }
  function stopAllPreviews() { Array.from(previews.keys()).forEach(stopPreview); }

  /* ---------- wiring ---------- */
  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      const slug = card.dataset.name;
      if (current === slug && readRoute().slug === slug) {
        // The open game's own card: no navigation happens, so act here.
        event.preventDefault();
        if (!running) startGame();
        window.scrollTo(0, 0);
        panel.focus({ preventScroll: true });
        return;
      }
      pendingPlay = slug;
    });
    card.addEventListener('mouseenter', () => { if (canHover.matches) startPreview(card); });
    card.addEventListener('mouseleave', () => stopPreview(card));
    card.addEventListener('focus', () => { if (!quietFocus && card.matches(':focus-visible')) startPreview(card); });
    card.addEventListener('blur', () => stopPreview(card));
  });

  startButton.addEventListener('click', startGame);
  stopButton.addEventListener('click', () => {
    if (readRoute().name === 'home') { closePanel(); window.scrollTo(0, 0); }
    else location.hash = '#home';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && current && !document.fullscreenElement) stopButton.click();
  });

  window.addEventListener('hashchange', () => onRoute(false));
  onRoute(true);
})();
