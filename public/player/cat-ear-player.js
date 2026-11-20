const template = document.createElement('template');

template.innerHTML = `
  <style>
    :host {
      --player-color: #d8cef2;
      --shell-top: color-mix(in srgb, var(--player-color) 72%, white);
      --shell-bottom: color-mix(in srgb, var(--player-color) 94%, #b9a7dc);
      --shell-deep: color-mix(in srgb, var(--player-color) 64%, #78658f);
      --ink: color-mix(in srgb, var(--player-color) 36%, #433b54);
      --ear-inner: #efbed2;
      display: block;
      width: min(344px, 100%);
      color: var(--ink);
      font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
    }

    * { box-sizing: border-box; }

    .wrap {
      position: relative;
      width: 100%;
      height: 86px;
    }

    .shell {
      position: absolute;
      z-index: 1;
      top: 0;
      left: 0;
      width: 100%;
      height: 86px;
      overflow: visible;
      filter: drop-shadow(0 15px 13px rgba(106, 84, 153, .16));
    }

    .ear-group {
      transform-box: fill-box;
      transform-origin: center bottom;
      transition: transform 280ms cubic-bezier(.2, .75, .2, 1), opacity 220ms ease;
    }

    .shell-body {
      fill: url(#shell-gradient);
      stroke: rgba(255, 255, 255, .86);
      stroke-width: 1;
    }

    .ear-inner {
      fill: var(--ear-inner);
      opacity: .82;
    }

    .shell-highlight {
      fill: none;
      stroke: rgba(255, 255, 255, .7);
      stroke-linecap: round;
    }

    .bubble {
      position: absolute;
      z-index: 2;
      top: 10px;
      left: 0;
      width: 100%;
      height: 76px;
      padding: 0 20px 0 15px;
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      align-items: center;
      gap: 15px;
      overflow: hidden;
      border-radius: 25px;
      background: linear-gradient(155deg, rgba(255, 255, 255, .18), transparent 52%);
    }

    .bubble::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: .18;
      background-image: radial-gradient(color-mix(in srgb, var(--ink) 28%, transparent) .55px, transparent .65px);
      background-size: 4px 4px;
      mix-blend-mode: soft-light;
    }

    .control {
      position: relative;
      z-index: 3;
      width: 46px;
      height: 46px;
      padding: 0;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, .72);
      border-radius: 17px;
      color: var(--ink);
      background: rgba(255, 255, 255, .49);
      box-shadow: 0 5px 13px color-mix(in srgb, var(--shell-deep) 11%, transparent), inset 0 1px 0 rgba(255, 255, 255, .7);
      cursor: pointer;
      transition: transform 160ms ease, opacity 160ms ease;
    }

    .control:hover { transform: translateY(-1px); }
    .control:active { transform: translateY(0) scale(.97); }
    .control:focus-visible { outline: 2px solid color-mix(in srgb, var(--ink) 52%, white); outline-offset: 3px; }
    .control:disabled { cursor: wait; opacity: .68; }
    .control svg { width: 20px; height: 20px; fill: currentColor; }

    .wave {
      position: relative;
      z-index: 2;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0;
      min-width: 0;
    }

    .bar {
      width: 3px;
      height: var(--height);
      min-height: 4px;
      flex: 0 0 3px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 56%, white));
      opacity: .74;
      transform-origin: center;
    }

    .time {
      position: relative;
      z-index: 2;
      min-width: 42px;
      text-align: right;
      color: color-mix(in srgb, var(--ink) 76%, white);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      letter-spacing: .03em;
    }

    :host([state="loading"]) .ear-left { animation: ear-listen-left .72s ease-in-out infinite alternate; }
    :host([state="loading"]) .ear-right { animation: ear-listen-right .72s .12s ease-in-out infinite alternate; }
    :host([state="loading"]) .bar { animation: loading-pulse .8s ease-in-out infinite alternate; }
    :host([state="loading"]) .control svg { animation: spin 1s linear infinite; }

    :host([state="playing"]) .ear-left { animation: ear-play-left 1.15s ease-in-out infinite; }
    :host([state="playing"]) .ear-right { animation: ear-play-right 1.15s .14s ease-in-out infinite; }
    :host([state="playing"]) .bar {
      animation: wave 680ms ease-in-out infinite alternate;
      animation-delay: calc(var(--index) * -44ms);
    }

    :host([state="paused"]) .ear-left { transform: rotate(-6deg) scaleY(.82); }
    :host([state="paused"]) .ear-right { transform: rotate(6deg) scaleY(.82); }
    :host([state="paused"]) .bar { opacity: .58; }

    :host([state="ended"]) .ear-left { transform: rotate(-4deg) scaleY(.64); }
    :host([state="ended"]) .ear-right { transform: rotate(4deg) scaleY(.64); }
    :host([state="ended"]) .bar { height: 4px; opacity: .5; transition: height .35s ease; }

    @keyframes ear-listen-left { to { transform: rotate(-1deg) scaleY(1.08); } }
    @keyframes ear-listen-right { to { transform: rotate(1deg) scaleY(1.08); } }
    @keyframes ear-play-left { 0%, 100% { transform: none; } 45% { transform: rotate(-2deg) scaleY(1.03); } }
    @keyframes ear-play-right { 0%, 100% { transform: none; } 55% { transform: rotate(2deg) scaleY(1.03); } }
    @keyframes loading-pulse { to { opacity: .3; transform: scaleY(.68); } }
    @keyframes wave { from { transform: scaleY(.45); } to { transform: scaleY(1.28); } }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
      }
    }
  </style>
  <section class="wrap" aria-label="语音播放器">
    <svg class="shell" viewBox="0 0 344 86" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="shell-gradient" x1="0" y1="0" x2="0" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" style="stop-color:var(--shell-top)" />
          <stop offset="1" style="stop-color:var(--shell-bottom)" />
        </linearGradient>
        <clipPath id="shell-clip" clipPathUnits="userSpaceOnUse">
          <path d="M26 10 H318 C322 6 326 1 330 0 C335 4 339 10 342 21 C343 25 344 30 344 35 V61 C344 75 333 86 319 86 H25 C11 86 0 75 0 61 V35 C0 30 1 25 2 21 C5 10 9 4 14 0 C18 1 22 6 26 10 Z" />
        </clipPath>
      </defs>
      <path class="shell-body" d="M26 10 H318 C322 6 326 1 330 0 C335 4 339 10 342 21 C343 25 344 30 344 35 V61 C344 75 333 86 319 86 H25 C11 86 0 75 0 61 V35 C0 30 1 25 2 21 C5 10 9 4 14 0 C18 1 22 6 26 10 Z" />
      <g clip-path="url(#shell-clip)">
        <g class="ear-group ear-left">
          <path class="ear-inner" d="M7 19 C9 12 11 6 14 4 C17 5 21 9 24 13 C16 13 11 15 7 19 Z" />
        </g>
        <g class="ear-group ear-right">
          <path class="ear-inner" d="M337 19 C335 12 333 6 330 4 C327 5 323 9 320 13 C328 13 333 15 337 19 Z" />
        </g>
      </g>
      <path class="shell-highlight" d="M29 11 H315" />
    </svg>
    <div class="bubble">
      <button class="control" type="button" aria-label="播放"></button>
      <div class="wave" aria-hidden="true"></div>
      <span class="time">00:00</span>
    </div>
  </section>
`;

const icons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.25 5.2a1.2 1.2 0 0 1 1.82-1.02l9 5.8a1.2 1.2 0 0 1 0 2.04l-9 5.8a1.2 1.2 0 0 1-1.82-1.02V5.2Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.8c0-.44.36-.8.8-.8h2.1c.44 0 .8.36.8.8v12.4c0 .44-.36.8-.8.8H7.8a.8.8 0 0 1-.8-.8V5.8Zm6.3 0c0-.44.36-.8.8-.8h2.1c.44 0 .8.36.8.8v12.4c0 .44-.36.8-.8.8h-2.1a.8.8 0 0 1-.8-.8V5.8Z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.44 4.26.9.9 0 1 1 1.66.7A5.2 5.2 0 1 0 12 6.8H9.9a.9.9 0 1 1 0-1.8H12Zm-1.3 3.9a.85.85 0 0 1 1.3-.72l4.1 2.67a.85.85 0 0 1 0 1.42L12 14.94a.85.85 0 0 1-1.3-.71V8.9Z"/></svg>',
  loading: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 8.48 12h-2.2A7 7 0 1 1 12 5V3Z"/></svg>'
};

const stateLabels = {
  idle: '播放',
  loading: '正在生成语音',
  playing: '暂停',
  paused: '继续播放',
  ended: '重新播放'
};

const barHeights = [8, 16, 24, 13, 29, 20, 10, 25, 32, 17, 27, 12, 21, 30, 15, 23, 9, 18];

class CatEarPlayer extends HTMLElement {
  static get observedAttributes() {
    return ['color'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.append(template.content.cloneNode(true));

    this.audio = new Audio();
    this._objectUrl = null;
    this._requestController = null;
    this._control = this.shadowRoot.querySelector('.control');
    this._wave = this.shadowRoot.querySelector('.wave');
    this._time = this.shadowRoot.querySelector('.time');

    barHeights.forEach((height, index) => {
      const bar = document.createElement('i');
      bar.className = 'bar';
      bar.style.setProperty('--height', `${height}px`);
      bar.style.setProperty('--index', index);
      this._wave.append(bar);
    });

    this._control.addEventListener('click', () => this.toggle());
    this.audio.addEventListener('play', () => this._setState('playing'));
    this.audio.addEventListener('pause', () => {
      if (this.audio.ended || this.state === 'loading') return;
      this._setState(this.audio.currentTime > 0 ? 'paused' : 'idle');
    });
    this.audio.addEventListener('ended', () => this._setState('ended'));
    this.audio.addEventListener('loadedmetadata', () => this._renderDuration());
    this.audio.addEventListener('durationchange', () => this._renderDuration());
    this.audio.addEventListener('error', () => {
      this._setState('idle');
      this.dispatchEvent(new CustomEvent('playererror', {
        detail: { code: 'AUDIO_PLAYBACK_ERROR' },
        bubbles: true
      }));
    });

    this._setState('idle');
  }

  connectedCallback() {
    this._applyColor();
  }

  disconnectedCallback() {
    this._requestController?.abort();
    this.audio.pause();
    this._revokeObjectUrl();
  }

  attributeChangedCallback(name) {
    if (name === 'color') this._applyColor();
  }

  get state() {
    return this.getAttribute('state') || 'idle';
  }

  _applyColor() {
    const color = this.getAttribute('color') || '#D8CEF2';
    this.style.setProperty('--player-color', color);
  }

  _setState(state) {
    if (!Object.hasOwn(stateLabels, state)) return;
    this.setAttribute('state', state);
    const label = stateLabels[state];
    this._control.setAttribute('aria-label', label);
    this._control.disabled = state === 'loading';
    this._control.innerHTML = state === 'playing'
      ? icons.pause
      : state === 'loading'
        ? icons.loading
        : state === 'ended'
          ? icons.replay
          : icons.play;

    if (state === 'loading') this._time.textContent = '···';
    else this._renderDuration();

    this.dispatchEvent(new CustomEvent('statechange', {
      detail: { state },
      bubbles: true
    }));
  }

  _renderDuration() {
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    const totalSeconds = Math.max(0, Math.round(duration));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    this._time.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  _revokeObjectUrl() {
    if (!this._objectUrl) return;
    URL.revokeObjectURL(this._objectUrl);
    this._objectUrl = null;
  }

  setLoading(loading) {
    if (loading) {
      this.audio.pause();
      this._setState('loading');
      return;
    }
    this._setState(this.audio.src ? 'idle' : 'idle');
  }

  setAudioBlob(blob) {
    if (!(blob instanceof Blob) || !blob.type.startsWith('audio/')) {
      throw new TypeError('setAudioBlob requires an audio Blob');
    }
    this.audio.pause();
    this._revokeObjectUrl();
    this._objectUrl = URL.createObjectURL(blob);
    this.audio.src = this._objectUrl;
    this.audio.load();
    this._setState('idle');
  }

  setSource(url) {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new TypeError('setSource requires a non-empty URL');
    }
    this.audio.pause();
    this._revokeObjectUrl();
    this.audio.src = url;
    this.audio.load();
    this._setState('idle');
  }

  async synthesize(text, { endpoint = '/api/tts' } = {}) {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (normalizedText.length < 1 || normalizedText.length > 1000) {
      throw new TypeError('text must contain 1 to 1000 characters');
    }

    this._requestController?.abort();
    const requestController = new AbortController();
    this._requestController = requestController;
    this.setLoading(true);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizedText }),
        signal: requestController.signal
      });

      if (!response.ok) {
        let code = 'TTS_REQUEST_FAILED';
        try {
          const body = await response.json();
          if (body?.error?.code) code = body.error.code;
        } catch {}
        throw new Error(code);
      }

      const blob = await response.blob();
      if (!blob.type.startsWith('audio/')) throw new Error('INVALID_AUDIO_RESPONSE');
      this.setAudioBlob(blob);
      return blob;
    } catch (error) {
      if (this._requestController === requestController) this._setState('idle');
      throw error;
    } finally {
      if (this._requestController === requestController) this._requestController = null;
    }
  }

  async play() {
    if (!this.audio.src || this.state === 'loading') return;
    if (this.audio.ended) this.audio.currentTime = 0;
    await this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    if (this.state === 'playing') this.pause();
    else this.play();
  }

  reset() {
    this.audio.pause();
    if (this.audio.src) this.audio.currentTime = 0;
    this._setState('idle');
  }

  previewState(state) {
    this.audio.pause();
    this._setState(state);
  }
}

if (!customElements.get('cat-ear-player')) {
  customElements.define('cat-ear-player', CatEarPlayer);
}

export { CatEarPlayer };
