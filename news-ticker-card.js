/*! news-ticker-card.js — modern broadcast news ticker for Home Assistant
 *  Reads flat JSON string arrays  ["Headline", ...]  from /local/news_*.json
 *  v2.1 — 4 selectable styles (breaking | glass | live | split), EN/TA toggle,
 *         live clock, visual editor. Backend contract unchanged.
 */
const NTC_VERSION = "2.1";
const NTC_STYLES = ["breaking", "glass", "live", "split"];
const NTC_DEFAULT_LABEL = { breaking: "BREAKING", glass: "NEWS", live: "LIVE", split: "TOP NEWS" };

class NewsTickerCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("news-ticker-card: missing config");
    const style = NTC_STYLES.indexOf(config.style) >= 0 ? config.style : "glass";
    this._config = Object.assign({
      news_url_en: "/local/news_en.json",
      news_url_ta: "/local/news_ta.json",
      default_lang: "en",
      refresh_minutes: 11,
      style: style,
      label: NTC_DEFAULT_LABEL[style],
      label_ta: "செய்திகள்",
      accent: "",                // "" => use the style's own default accent
      speed: 60,                 // px per second
      separator: "",             // "" => use the style's own default separator
      font_size: 18,
      show_clock: true,
      clock_seconds: true,
      show_date: false,
      show_label: true,
      show_lang_toggle: true,
      pause_on_hover: true,
      uppercase: true,
    }, config);
    this._config.style = style;
    if (config.label == null) this._config.label = NTC_DEFAULT_LABEL[style];

    let lang = this._config.default_lang === "ta" ? "ta" : "en";
    try {
      const saved = localStorage.getItem("ntc_lang");
      if (saved === "en" || saved === "ta") lang = saved;
    } catch (e) {}
    this._lang = lang;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
    this._build();
    this._loadNews();
    this._startClock();
    this._scheduleRefresh();
  }

  set hass(h) { this._hass = h; }

  connectedCallback() {
    if (this._config && !this._built) {
      this._build(); this._loadNews(); this._startClock(); this._scheduleRefresh();
    }
  }
  disconnectedCallback() {
    clearInterval(this._clockTimer); clearInterval(this._refreshTimer);
  }

  _scheduleRefresh() {
    clearInterval(this._refreshTimer);
    const m = Number(this._config.refresh_minutes) || 11;
    this._refreshTimer = setInterval(() => this._loadNews(), m * 60 * 1000);
  }
  _startClock() {
    clearInterval(this._clockTimer);
    if (!this._config.show_clock && !this._config.show_date) return;
    const tick = () => this._updateTime();
    tick();
    this._clockTimer = setInterval(tick, 1000);
  }
  _updateTime() {
    const el = this.shadowRoot && this.shadowRoot.getElementById("clock");
    if (!el) return;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    let out = "";
    if (this._config.show_date)
      out += now.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + "  ";
    if (this._config.show_clock) {
      out += pad(now.getHours()) + ":" + pad(now.getMinutes());
      if (this._config.clock_seconds) out += ":" + pad(now.getSeconds());
    }
    el.textContent = out.trim();
  }

  _url() {
    const base = this._lang === "ta" ? this._config.news_url_ta : this._config.news_url_en;
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
  }
  async _loadNews() {
    try {
      const resp = await fetch(this._url(), { cache: "no-store" });
      const headlines = await resp.json();
      if (!Array.isArray(headlines) || !headlines.length) {
        this._setStatus("⚠ No headlines — run the fetch script first"); return;
      }
      this._headlines = headlines;
      this._renderTicker();
    } catch (e) { this._setStatus("⚠ " + e.message); }
  }
  _setStatus(msg) {
    const track = this.shadowRoot && this.shadowRoot.getElementById("track");
    if (track) track.innerHTML = '<span class="status">' + this._esc(msg) + "</span>";
  }

  _accent() {
    if (this._config.accent) return this._config.accent;
    return { breaking: "#e10600", glass: "#5dcaa5", live: "#2bd4c4", split: "#7f77dd" }[this._config.style];
  }
  _sep() {
    if (this._config.separator) return this._config.separator;
    return { breaking: "◆", glass: "/", live: "•", split: "·" }[this._config.style];
  }

  _build() {
    const c = this._config, root = this.shadowRoot;
    const accent = this._accent();
    const fs = Number(c.font_size) || 18;
    root.innerHTML = `
      <style>
        :host { display: block; }
        .bar {
          --accent: ${accent};
          display: flex; align-items: stretch; position: relative;
          height: calc(${fs}px + 24px);
          border-radius: 12px; overflow: hidden; color: #fff;
          font-family: var(--ntc-font, system-ui, sans-serif);
        }
        .rail { display: none; width: 4px; background: var(--accent); }
        .badge { display: ${c.show_label ? "flex" : "none"}; align-items: center; gap: 8px;
          white-space: nowrap; font-weight: 500; }
        .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
        #label { font-size: ${Math.max(12, fs - 3)}px; }
        .tk { flex: 1; overflow: hidden; position: relative; display: flex; align-items: center;
          -webkit-mask-image: linear-gradient(90deg,transparent,#000 20px,#000 calc(100% - 20px),transparent);
          mask-image: linear-gradient(90deg,transparent,#000 20px,#000 calc(100% - 20px),transparent); }
        .trk { display: inline-flex; align-items: center; white-space: nowrap; will-change: transform;
          font-size: ${fs}px; font-weight: 500; animation: ntc-scroll linear infinite; }
        .tk:hover .trk { animation-play-state: ${c.pause_on_hover ? "paused" : "running"}; }
        .headline { padding: 0 2px; }
        .sep { color: var(--accent); padding: 0 15px; }
        .status { padding: 0 18px; opacity: .7; }
        @keyframes ntc-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes ntc-pulse { 0%{box-shadow:0 0 0 0 rgba(255,255,255,.55);} 70%{box-shadow:0 0 0 7px rgba(255,255,255,0);} 100%{box-shadow:0 0 0 0 rgba(255,255,255,0);} }
        .side { display: flex; align-items: center; gap: 10px; padding: 0 12px; white-space: nowrap; }
        #clock { font-variant-numeric: tabular-nums; font-weight: 500; font-size: ${Math.max(12, fs - 4)}px; letter-spacing: .3px; }
        .toggle { display: ${c.show_lang_toggle ? "inline-flex" : "none"}; border: 1px solid rgba(255,255,255,.22);
          border-radius: 999px; overflow: hidden; font-size: ${Math.max(11, fs - 7)}px; font-weight: 500; cursor: pointer; user-select: none; }
        .toggle span { padding: 3px 9px; opacity: .5; }
        .toggle span.on { background: var(--accent); opacity: 1; }

        /* breaking */
        .bar[data-style="breaking"] { background: rgba(18,20,26,.55); backdrop-filter: blur(11px) saturate(140%);
          -webkit-backdrop-filter: blur(11px) saturate(140%); border: 1px solid rgba(255,255,255,.08); }
        .bar[data-style="breaking"] .badge { background: var(--accent); padding: 0 24px 0 14px;
          letter-spacing: 1.3px; text-transform: ${c.uppercase ? "uppercase" : "none"};
          clip-path: polygon(0 0,100% 0,calc(100% - 12px) 100%,0 100%); }
        .bar[data-style="breaking"] .badge .dot { animation: ntc-pulse 1.6s infinite; }

        /* glass */
        .bar[data-style="glass"] { background: rgba(255,255,255,.07); backdrop-filter: blur(14px) saturate(150%);
          -webkit-backdrop-filter: blur(14px) saturate(150%); border: 1px solid rgba(255,255,255,.12); }
        .bar[data-style="glass"] .rail { display: block; }
        .bar[data-style="glass"] .badge { padding: 0 14px; color: var(--accent); letter-spacing: .5px; }
        .bar[data-style="glass"] .badge .dot { display: none; }
        .bar[data-style="glass"] .side { color: #d3d9e0; }

        /* live */
        .bar[data-style="live"] { background: #07090d; border: 1px solid #1c2430; }
        .bar[data-style="live"] .badge { padding: 0 18px 0 14px; color: var(--accent); letter-spacing: 2px;
          text-transform: uppercase; }
        .bar[data-style="live"] .badge .dot { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
        .bar[data-style="live"] .trk { text-transform: uppercase; letter-spacing: .5px; color: #dfe6ee; font-size: ${Math.max(12, fs - 3)}px; }
        .bar[data-style="live"] .side { color: #6b7a88; border-left: 1px solid #1c2430; }

        /* split */
        .bar[data-style="split"] { background: rgba(20,16,28,.6); backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%); border: 1px solid rgba(255,255,255,.08); }
        .bar[data-style="split"] .badge { background: var(--accent); padding: 0 16px; letter-spacing: .7px;
          text-transform: ${c.uppercase ? "uppercase" : "none"}; }
        .bar[data-style="split"] .badge .dot { display: none; }
        .bar[data-style="split"] .side { color: #c9c4e8; }
      </style>
      <div class="bar" data-style="${c.style}">
        <div class="rail"></div>
        <div class="badge"><span class="dot"></span><span id="label"></span></div>
        <div class="tk"><div class="trk" id="track"></div></div>
        <div class="side">
          <div id="clock"></div>
          <div class="toggle" id="toggle"><span data-l="en">EN</span><span data-l="ta">TA</span></div>
        </div>
      </div>`;
    this._built = true;
    this._syncLabel(); this._syncToggle();
    const tog = root.getElementById("toggle");
    if (tog) tog.addEventListener("click", (e) => {
      const l = e.target && e.target.getAttribute("data-l");
      if (!l || l === this._lang) return;
      this._lang = l;
      try { localStorage.setItem("ntc_lang", l); } catch (err) {}
      this._syncLabel(); this._syncToggle(); this._loadNews();
    });
    this._updateTime();
    if (this._headlines) this._renderTicker();
  }

  _syncLabel() {
    const el = this.shadowRoot.getElementById("label");
    if (el) el.textContent = this._lang === "ta"
      ? (this._config.label_ta || this._config.label) : this._config.label;
  }
  _syncToggle() {
    const t = this.shadowRoot.getElementById("toggle");
    if (!t) return;
    t.querySelectorAll("span").forEach((s) => s.classList.toggle("on", s.getAttribute("data-l") === this._lang));
  }

  _renderTicker() {
    const track = this.shadowRoot && this.shadowRoot.getElementById("track");
    if (!track || !this._headlines) return;
    const sep = '<span class="sep">' + this._esc(this._sep()) + "</span>";
    const items = this._headlines.map((h) => '<span class="headline">' + this._esc(h) + "</span>").join(sep);
    track.innerHTML = items + sep + items + sep;
    requestAnimationFrame(() => {
      const w = track.scrollWidth / 2;
      const speed = Math.max(10, Number(this._config.speed) || 60);
      track.style.animationDuration = (w / speed) + "s";
    });
  }

  _esc(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }
  getCardSize() { return 1; }

  static getConfigElement() { return document.createElement("news-ticker-card-editor"); }
  static getStubConfig() { return { style: "glass", label: "NEWS", news_url_en: "/local/news_en.json", news_url_ta: "/local/news_ta.json" }; }
}
customElements.define("news-ticker-card", NewsTickerCard);

/* ---------------- visual editor ---------------- */
class NewsTickerCardEditor extends HTMLElement {
  setConfig(config) { this._config = Object.assign({}, config); this._render(); }
  set hass(h) { this._hass = h; }
  _emit() {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    const esc = (v) => v == null ? "" : String(v).replace(/"/g, "&quot;");
    const row = (label, key, type, val) =>
      '<label class="r"><span>' + label + '</span><input data-key="' + key + '" type="' + type + '" value="' + esc(val) + '" ' +
      (type === "checkbox" && val ? "checked" : "") + "></label>";
    const styleSel =
      '<label class="r"><span>Style</span><select data-key="style">' +
      NTC_STYLES.map((s) => '<option value="' + s + '"' + (c.style === s ? " selected" : "") + ">" +
        s.charAt(0).toUpperCase() + s.slice(1) + "</option>").join("") + "</select></label>";
    this.shadowRoot.innerHTML = `
      <style>
        .r{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:5px 0;}
        .r span{font-size:14px;}
        select,input[type=text],input[type=number]{width:58%;padding:6px;border-radius:6px;
          border:1px solid var(--divider-color,#ccc);background:var(--card-background-color,#fff);color:var(--primary-text-color,#000);}
        input[type=color]{width:44px;height:28px;border:none;background:none;padding:0;}
      </style>
      <div>
        ${styleSel}
        ${row("Badge text (EN)", "label", "text", c.label != null ? c.label : "")}
        ${row("Badge text (TA)", "label_ta", "text", c.label_ta != null ? c.label_ta : "")}
        ${row("Accent (blank = style default)", "accent", "text", c.accent != null ? c.accent : "")}
        ${row("Scroll speed (px/s)", "speed", "number", c.speed != null ? c.speed : 60)}
        ${row("Font size (px)", "font_size", "number", c.font_size != null ? c.font_size : 18)}
        ${row("Refresh (minutes)", "refresh_minutes", "number", c.refresh_minutes != null ? c.refresh_minutes : 11)}
        ${row("Default language (en/ta)", "default_lang", "text", c.default_lang || "en")}
        ${row("Separator (blank = default)", "separator", "text", c.separator != null ? c.separator : "")}
        ${row("Show clock", "show_clock", "checkbox", c.show_clock !== false)}
        ${row("Clock seconds", "clock_seconds", "checkbox", c.clock_seconds !== false)}
        ${row("Show date", "show_date", "checkbox", !!c.show_date)}
        ${row("Show badge", "show_label", "checkbox", c.show_label !== false)}
        ${row("Show EN/TA toggle", "show_lang_toggle", "checkbox", c.show_lang_toggle !== false)}
        ${row("Pause on hover", "pause_on_hover", "checkbox", c.pause_on_hover !== false)}
        ${row("Uppercase badge", "uppercase", "checkbox", c.uppercase !== false)}
        ${row("News URL (EN)", "news_url_en", "text", c.news_url_en || "/local/news_en.json")}
        ${row("News URL (TA)", "news_url_ta", "text", c.news_url_ta || "/local/news_ta.json")}
      </div>`;
    const commit = (k, v) => { this._config = Object.assign({}, this._config, { [k]: v }); this._emit(); };
    this.shadowRoot.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const k = e.target.getAttribute("data-key");
        let v;
        if (e.target.type === "checkbox") v = e.target.checked;
        else if (e.target.type === "number") v = Number(e.target.value);
        else v = e.target.value;
        commit(k, v);
      });
    });
    const sel = this.shadowRoot.querySelector("select");
    if (sel) sel.addEventListener("change", (e) => commit("style", e.target.value));
  }
}
customElements.define("news-ticker-card-editor", NewsTickerCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({ type: "news-ticker-card", name: "News Ticker Card",
  description: "Broadcast-style scrolling news ticker (EN/Tamil), 4 styles, live clock.", preview: true });
console.info("%c NEWS-TICKER-CARD %c v" + NTC_VERSION + " ",
  "background:#e10600;color:#fff;font-weight:700;border-radius:4px 0 0 4px;", "background:#333;color:#fff;border-radius:0 4px 4px 0;");
