/*! news-ticker-card.js — modern broadcast news ticker for Home Assistant
 *  Headlines from /local/news_*.json  (flat ["Headline", ...] arrays)
 *  Info (gold/silver/weather/date/location) from /local/info.json
 *  v2.4 — 4 styles, EN/TA toggle, live clock, info rotates in the badge
 *         (small text, alternating with the label) or as a standalone chip.
 */
const NTC_VERSION = "2.4";
const NTC_STYLES = ["breaking", "glass", "live", "split"];
const NTC_DEFAULT_LABEL = { breaking: "BREAKING", glass: "NEWS", live: "LIVE", split: "TOP NEWS" };
const NTC_INFO_ALL = ["gold24", "gold22", "silver", "weather", "date", "location"];
const NTC_INFO_LABEL = { gold24: "GOLD 24K", gold22: "GOLD 22K", silver: "SILVER", weather: "", date: "", location: "" };

class NewsTickerCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("news-ticker-card: missing config");
    const style = NTC_STYLES.indexOf(config.style) >= 0 ? config.style : "glass";
    this._config = Object.assign({
      news_url_en: "/local/news_en.json",
      news_url_ta: "/local/news_ta.json",
      info_url: "/local/info.json",
      default_lang: "en",
      refresh_minutes: 11,
      style: style,
      label: NTC_DEFAULT_LABEL[style],
      label_ta: "செய்திகள்",
      accent: "",
      speed: 60,
      separator: "",
      font_size: 18,
      show_clock: true,
      clock_seconds: true,
      show_date: false,
      show_label: true,
      show_lang_toggle: true,
      pause_on_hover: true,
      uppercase: true,
      show_info: false,
      info_items: ["gold24", "silver", "weather", "date"],
      info_rotate_seconds: 6,
      info_position: "badge",   // "badge" = rotate with the label (small text) | "inline" = separate chip
      location: "",
    }, config);
    this._config.style = style;
    if (config.label == null) this._config.label = NTC_DEFAULT_LABEL[style];
    if (!Array.isArray(this._config.info_items)) this._config.info_items = [];

    let lang = this._config.default_lang === "ta" ? "ta" : "en";
    try {
      const saved = localStorage.getItem("ntc_lang");
      if (saved === "en" || saved === "ta") lang = saved;
    } catch (e) {}
    this._lang = lang;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
    this._info = null;
    this._badgeIdx = 0;
    this._infoIdx = 0;
    this._build();
    this._loadNews();
    this._loadInfo();
    this._startClock();
    this._startRotate();
    this._scheduleRefresh();
  }

  set hass(h) { this._hass = h; }

  connectedCallback() {
    if (this._config && !this._built) {
      this._build(); this._loadNews(); this._loadInfo();
      this._startClock(); this._startRotate(); this._scheduleRefresh();
    }
  }
  disconnectedCallback() {
    clearInterval(this._clockTimer); clearInterval(this._refreshTimer); clearInterval(this._rotTimer);
  }

  _inline() { return this._config.info_position === "inline"; }

  _scheduleRefresh() {
    clearInterval(this._refreshTimer);
    const m = Number(this._config.refresh_minutes) || 11;
    this._refreshTimer = setInterval(() => { this._loadNews(); this._loadInfo(); }, m * 60 * 1000);
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
  async _loadInfo() {
    if (!this._config.show_info) return;
    try {
      const u = this._config.info_url + (this._config.info_url.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
      const resp = await fetch(u, { cache: "no-store" });
      const doc = await resp.json();
      this._info = doc && doc.items ? doc : { items: {}, location: "" };
    } catch (e) { /* keep last good */ }
    if (this._inline()) this._renderInfoChip(); else this._renderBadge();
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

  _labelText() {
    return this._lang === "ta" ? (this._config.label_ta || this._config.label) : this._config.label;
  }
  _infoValue(id) {
    if (id === "date")
      return new Date().toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
    if (id === "location") {
      const loc = this._config.location || (this._info && this._info.location) || "";
      return loc ? "📍 " + loc : "";
    }
    return this._info && this._info.items ? (this._info.items[id] || "") : "";
  }
  _activeInfoItems() {
    const out = [];
    (this._config.info_items || []).forEach((id) => {
      if (NTC_INFO_ALL.indexOf(id) < 0) return;
      if (this._infoValue(id)) out.push(id);
    });
    return out;
  }
  _infoHTML(id) {
    const label = NTC_INFO_LABEL[id];
    return (label ? '<span class="ilabel">' + this._esc(label) + "</span>" : "") +
           '<span class="ival">' + this._esc(this._infoValue(id)) + "</span>";
  }

  // badge mode: a single slot that cycles [label, ...info items]
  _badgeSeq() {
    const items = (this._config.show_info && !this._inline()) ? this._activeInfoItems() : [];
    return ["__label__"].concat(items);
  }
  _renderBadge() {
    const slot = this.shadowRoot && this.shadowRoot.getElementById("label");
    if (!slot) return;
    const seq = this._badgeSeq();
    if (this._badgeIdx >= seq.length) this._badgeIdx = 0;
    const it = seq[this._badgeIdx];
    if (it === "__label__") slot.innerHTML = '<span class="blabel">' + this._esc(this._labelText()) + "</span>";
    else slot.innerHTML = '<span class="binfo">' + this._infoHTML(it) + "</span>";
  }

  // inline mode: standalone chip element (#info)
  _renderInfoChip() {
    const el = this.shadowRoot && this.shadowRoot.getElementById("info");
    if (!el) return;
    const items = this._activeInfoItems();
    if (!items.length) { el.style.display = "none"; el.innerHTML = ""; return; }
    el.style.display = "flex";
    if (this._infoIdx >= items.length) this._infoIdx = 0;
    el.innerHTML = this._infoHTML(items[this._infoIdx]);
  }

  _startRotate() {
    clearInterval(this._rotTimer);
    const secs = Math.max(2, Number(this._config.info_rotate_seconds) || 6);
    if (this._inline()) {
      this._renderBadge();          // label static
      this._renderInfoChip();
      if (!this._config.show_info) return;
      this._rotTimer = setInterval(() => {
        const items = this._activeInfoItems();
        if (items.length <= 1) { this._renderInfoChip(); return; }
        const el = this.shadowRoot && this.shadowRoot.getElementById("info");
        this._infoIdx = (this._infoIdx + 1) % items.length;
        if (el) { el.style.opacity = "0"; setTimeout(() => { this._renderInfoChip(); el.style.opacity = "1"; }, 180); }
        else this._renderInfoChip();
      }, secs * 1000);
      return;
    }
    // badge mode
    this._renderBadge();
    if (!this._config.show_info) return;
    this._rotTimer = setInterval(() => {
      const seq = this._badgeSeq();
      if (seq.length <= 1) { this._renderBadge(); return; }
      const slot = this.shadowRoot && this.shadowRoot.getElementById("label");
      this._badgeIdx = (this._badgeIdx + 1) % seq.length;
      if (slot) { slot.style.opacity = "0"; setTimeout(() => { this._renderBadge(); slot.style.opacity = "1"; }, 180); }
      else this._renderBadge();
    }, secs * 1000);
  }

  _build() {
    const c = this._config, root = this.shadowRoot;
    const accent = this._accent();
    const fs = Number(c.font_size) || 18;
    const ifs = Math.max(10, Math.round(fs - 24));     // small info text in badge
    const inline = this._inline();
    root.innerHTML = `
      <style>
        :host { display: block; }
        .bar { --accent: ${accent}; display: flex; align-items: stretch; position: relative;
          height: calc(${fs}px + 24px); border-radius: 12px; overflow: hidden; color: #fff;
          font-family: var(--ntc-font, system-ui, sans-serif); }
        .rail { display: none; width: 4px; background: var(--accent); }
        .badge { display: ${c.show_label ? "flex" : "none"}; align-items: center; gap: 8px; white-space: nowrap; font-weight: 500; }
        .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; flex: 0 0 auto; }
        #label { display: inline-flex; align-items: center; transition: opacity .18s ease; }
        .blabel { font-size: ${Math.max(12, fs - 3)}px; }
        .binfo { display: inline-flex; align-items: baseline; }
        .binfo .ilabel { font-size: ${ifs}px; font-weight: 500; opacity: .62; letter-spacing: .3px; margin-right: 5px; }
        .binfo .ival { font-size: ${ifs}px; font-weight: 500; opacity: .95; }
        .info { display: none; align-items: center; gap: 7px; padding: 0 14px; white-space: nowrap;
          background: rgba(0,0,0,.22); transition: opacity .18s ease; }
        .info .ilabel { font-size: ${Math.max(10, fs - 7)}px; font-weight: 500; opacity: .7; letter-spacing: .4px; }
        .info .ival { font-size: ${Math.max(12, fs - 3)}px; font-weight: 500; color: var(--accent); }
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

        .bar[data-style="breaking"] { background: rgba(18,20,26,.55); backdrop-filter: blur(11px) saturate(140%);
          -webkit-backdrop-filter: blur(11px) saturate(140%); border: 1px solid rgba(255,255,255,.08); }
        .bar[data-style="breaking"] .badge { background: var(--accent); padding: 0 24px 0 14px; letter-spacing: 1.3px;
          text-transform: ${c.uppercase ? "uppercase" : "none"}; clip-path: polygon(0 0,100% 0,calc(100% - 12px) 100%,0 100%); }
        .bar[data-style="breaking"] .badge .dot { animation: ntc-pulse 1.6s infinite; }

        .bar[data-style="glass"] { background: rgba(255,255,255,.07); backdrop-filter: blur(14px) saturate(150%);
          -webkit-backdrop-filter: blur(14px) saturate(150%); border: 1px solid rgba(255,255,255,.12); }
        .bar[data-style="glass"] .rail { display: block; }
        .bar[data-style="glass"] .badge { padding: 0 14px; color: var(--accent); letter-spacing: .5px; }
        .bar[data-style="glass"] .badge .dot { display: none; }
        .bar[data-style="glass"] .side { color: #d3d9e0; }

        .bar[data-style="live"] { background: #07090d; border: 1px solid #1c2430; }
        .bar[data-style="live"] .badge { padding: 0 18px 0 14px; color: var(--accent); letter-spacing: 2px; text-transform: uppercase; }
        .bar[data-style="live"] .badge .dot { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
        .bar[data-style="live"] .trk { text-transform: uppercase; letter-spacing: .5px; color: #dfe6ee; font-size: ${Math.max(12, fs - 3)}px; }
        .bar[data-style="live"] .side { color: #6b7a88; border-left: 1px solid #1c2430; }
        .bar[data-style="live"] .info { background: #0b0f15; }

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
        ${inline ? '<div class="info" id="info"></div>' : ""}
        <div class="tk"><div class="trk" id="track"></div></div>
        <div class="side">
          <div id="clock"></div>
          <div class="toggle" id="toggle"><span data-l="en">EN</span><span data-l="ta">TA</span></div>
        </div>
      </div>`;
    this._built = true;
    this._renderBadge();
    this._syncToggle();
    const tog = root.getElementById("toggle");
    if (tog) tog.addEventListener("click", (e) => {
      const l = e.target && e.target.getAttribute("data-l");
      if (!l || l === this._lang) return;
      this._lang = l;
      try { localStorage.setItem("ntc_lang", l); } catch (err) {}
      this._renderBadge(); this._syncToggle(); this._loadNews();
    });
    this._updateTime();
    if (this._headlines) this._renderTicker();
    if (this._info && this._inline()) this._renderInfoChip();
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
  _emit() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    const esc = (v) => v == null ? "" : String(v).replace(/"/g, "&quot;");
    const row = (label, key, type, val) =>
      '<label class="r"><span>' + label + '</span><input data-key="' + key + '" type="' + type + '" value="' + esc(val) + '" ' +
      (type === "checkbox" && val ? "checked" : "") + "></label>";
    const opt = (key, val, choices) =>
      '<label class="r"><span>' + key.label + '</span><select data-key="' + key.k + '">' +
      choices.map((o) => '<option value="' + o + '"' + (val === o ? " selected" : "") + ">" + o + "</option>").join("") + "</select></label>";
    const styleSel =
      '<label class="r"><span>Style</span><select data-key="style">' +
      NTC_STYLES.map((s) => '<option value="' + s + '"' + (c.style === s ? " selected" : "") + ">" +
        s.charAt(0).toUpperCase() + s.slice(1) + "</option>").join("") + "</select></label>";
    const sel = Array.isArray(c.info_items) ? c.info_items : [];
    const infoChecks = NTC_INFO_ALL.map((id) => '<label class="r"><span>' + (NTC_INFO_LABEL[id] || id) +
      ' <small>(' + id + ')</small></span><input data-info="' + id + '" type="checkbox" ' +
      (sel.indexOf(id) >= 0 ? "checked" : "") + "></label>").join("");
    this.shadowRoot.innerHTML = `
      <style>
        .r{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:5px 0;}
        .r span{font-size:14px;} .r small{opacity:.6;}
        .sec{margin:10px 0 2px;font-size:13px;font-weight:500;opacity:.8;border-top:1px solid var(--divider-color,#333);padding-top:8px;}
        select,input[type=text],input[type=number]{width:58%;padding:6px;border-radius:6px;
          border:1px solid var(--divider-color,#ccc);background:var(--card-background-color,#fff);color:var(--primary-text-color,#000);}
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
        ${row("Location", "location", "text", c.location != null ? c.location : "")}
        <div class="sec">Toggles</div>
        ${row("Show clock", "show_clock", "checkbox", c.show_clock !== false)}
        ${row("Clock seconds", "clock_seconds", "checkbox", c.clock_seconds !== false)}
        ${row("Show date (clock area)", "show_date", "checkbox", !!c.show_date)}
        ${row("Show badge", "show_label", "checkbox", c.show_label !== false)}
        ${row("Show EN/TA toggle", "show_lang_toggle", "checkbox", c.show_lang_toggle !== false)}
        ${row("Pause on hover", "pause_on_hover", "checkbox", c.pause_on_hover !== false)}
        ${row("Uppercase badge", "uppercase", "checkbox", c.uppercase !== false)}
        <div class="sec">Info</div>
        ${row("Show info", "show_info", "checkbox", !!c.show_info)}
        ${opt({ k: "info_position", label: "Info position" }, c.info_position || "badge", ["badge", "inline"])}
        ${row("Rotate every (seconds)", "info_rotate_seconds", "number", c.info_rotate_seconds != null ? c.info_rotate_seconds : 6)}
        ${infoChecks}
        <div class="sec">Sources</div>
        ${row("News URL (EN)", "news_url_en", "text", c.news_url_en || "/local/news_en.json")}
        ${row("News URL (TA)", "news_url_ta", "text", c.news_url_ta || "/local/news_ta.json")}
        ${row("Info URL", "info_url", "text", c.info_url || "/local/info.json")}
      </div>`;
    const commit = (k, v) => { this._config = Object.assign({}, this._config, { [k]: v }); this._emit(); };
    this.shadowRoot.querySelectorAll("input[data-key]").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const k = e.target.getAttribute("data-key");
        let v;
        if (e.target.type === "checkbox") v = e.target.checked;
        else if (e.target.type === "number") v = Number(e.target.value);
        else v = e.target.value;
        commit(k, v);
      });
    });
    this.shadowRoot.querySelectorAll("select[data-key]").forEach((s) => {
      s.addEventListener("change", (e) => commit(e.target.getAttribute("data-key"), e.target.value));
    });
    this.shadowRoot.querySelectorAll("input[data-info]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const items = [];
        this.shadowRoot.querySelectorAll("input[data-info]").forEach((x) => { if (x.checked) items.push(x.getAttribute("data-info")); });
        commit("info_items", items);
      });
    });
  }
}
customElements.define("news-ticker-card-editor", NewsTickerCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({ type: "news-ticker-card", name: "News Ticker Card",
  description: "Broadcast-style scrolling news ticker (EN/Tamil), 4 styles, live clock, rotating info.", preview: true });
console.info("%c NEWS-TICKER-CARD %c v" + NTC_VERSION + " ",
  "background:#e10600;color:#fff;font-weight:700;border-radius:4px 0 0 4px;", "background:#333;color:#fff;border-radius:0 4px 4px 0;");
