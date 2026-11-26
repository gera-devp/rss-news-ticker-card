/*! news-ticker-card.js — modern broadcast news ticker for Home Assistant
 *  Headlines from /local/news_*.json  (flat ["Headline", ...] arrays)
 *  Info (gold/silver/weather/date/location) from /local/info.json
 *  v2.4 — 4 styles, EN/TA toggle, live clock, info rotates in the badge.
 *  v2.5 — badge width pinned to its widest frame so it never resizes mid-cycle.
 *  v2.6 — info_font_size setting; when info text is bigger than the label it
 *         moves to a 2nd row under the label (badge grows) instead of one line.
 */
const NTC_VERSION = "2.7";
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
      info_position: "badge",   // "badge" = rotate with the label | "inline" = separate chip
      info_font_size: 0,        // 0 = auto (small). Bigger than the label -> 2nd row.
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
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  }

  _inline() { return this._config.info_position === "inline"; }
  _sizes() {
    const fs = Number(this._config.font_size) || 18;
    const labelSize = Math.max(12, fs - 3);
    const iSize = Number(this._config.info_font_size) > 0
      ? Number(this._config.info_font_size)
      : Math.max(10, Math.round(fs - 24));
    return { fs: fs, labelSize: labelSize, iSize: iSize };
  }
  // "inline" chip | "two" (label row + info row) | "badge1" (rotate on one line)
  _mode() {
    if (this._inline()) return "inline";
    if (!this._config.show_info) return "badge1";
    const s = this._sizes();
    return s.iSize > s.labelSize ? "two" : "badge1";
  }

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
    let main = "", secs = "";
    if (this._config.show_date)
      main += now.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " ";
    if (this._config.show_clock) {
      main += pad(now.getHours()) + ":" + pad(now.getMinutes());
      if (this._config.clock_seconds) secs = ":" + pad(now.getSeconds());
    }
    // seconds in their own span so a narrow screen can drop them via @container
    el.innerHTML = this._esc(main.trim()) + (secs ? '<span class="secs">' + secs + "</span>" : "");
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
    this._renderForMode();
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

  _renderForMode() {
    if (this._mode() === "badge1") { this._renderBadge(); this._fitBadge(); }
    else { this._renderLabel(); this._renderInfo(); }
  }

  _renderLabel() {
    const slot = this.shadowRoot && this.shadowRoot.getElementById("label");
    if (slot) slot.innerHTML = '<span class="blabel">' + this._esc(this._labelText()) + "</span>";
  }

  // badge1: single slot cycling [label, ...info items]
  _badgeSeq() {
    const items = (this._config.show_info && this._mode() === "badge1") ? this._activeInfoItems() : [];
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
  _fitBadge() {
    if (this._mode() !== "badge1") return;
    const slot = this.shadowRoot && this.shadowRoot.getElementById("label");
    const m = this.shadowRoot && this.shadowRoot.getElementById("measure");
    if (!slot || !m) return;
    const seq = this._badgeSeq();
    let max = 0;
    seq.forEach((it) => {
      m.innerHTML = it === "__label__"
        ? '<span class="blabel">' + this._esc(this._labelText()) + "</span>"
        : '<span class="binfo">' + this._infoHTML(it) + "</span>";
      if (m.offsetWidth > max) max = m.offsetWidth;
    });
    slot.style.minWidth = max > 0 ? max + "px" : "";
  }

  // two-row & inline: a separate #info element cycles the info items
  _renderInfo() {
    const el = this.shadowRoot && this.shadowRoot.getElementById("info");
    if (!el) return;
    const items = this._activeInfoItems();
    if (!items.length) { el.style.visibility = "hidden"; el.innerHTML = ""; return; }
    el.style.visibility = "visible";
    if (this._infoIdx >= items.length) this._infoIdx = 0;
    el.innerHTML = this._infoHTML(items[this._infoIdx]);
  }

  _startRotate() {
    clearInterval(this._rotTimer);
    const secs = Math.max(2, Number(this._config.info_rotate_seconds) || 6);
    const mode = this._mode();
    if (mode === "badge1") {
      this._renderBadge(); this._fitBadge();
      if (!this._config.show_info) return;
      this._rotTimer = setInterval(() => {
        const seq = this._badgeSeq();
        if (seq.length <= 1) { this._renderBadge(); return; }
        const slot = this.shadowRoot && this.shadowRoot.getElementById("label");
        this._badgeIdx = (this._badgeIdx + 1) % seq.length;
        if (slot) { slot.style.opacity = "0"; setTimeout(() => { this._renderBadge(); slot.style.opacity = "1"; }, 180); }
        else this._renderBadge();
      }, secs * 1000);
      return;
    }
    // two-row or inline: label static, info element rotates
    this._renderLabel();
    this._renderInfo();
    if (!this._config.show_info) return;
    this._rotTimer = setInterval(() => {
      const items = this._activeInfoItems();
      if (items.length <= 1) { this._renderInfo(); return; }
      const el = this.shadowRoot && this.shadowRoot.getElementById("info");
      this._infoIdx = (this._infoIdx + 1) % items.length;
      if (el) { el.style.opacity = "0"; setTimeout(() => { this._renderInfo(); el.style.opacity = "1"; }, 180); }
      else this._renderInfo();
    }, secs * 1000);
  }

  _build() {
    const c = this._config, root = this.shadowRoot;
    const accent = this._accent();
    const s = this._sizes();
    const fs = s.fs, labelSize = s.labelSize, iSize = s.iSize;
    const mode = this._mode();
    const inline = mode === "inline";
    const two = mode === "two";
    const barH = two ? Math.max(fs + 24, labelSize + iSize + 22) : (fs + 24);
    // responsive: scale to the card's own width (container query units), capped
    // at the configured px — big on a wide kiosk, smaller on a phone.
    const R = (min, cq, max) => `clamp(${min}px, ${cq}cqi, ${max}px)`;
    const iMin = two ? 11 : 9, iCq = two ? 3.4 : 2.6;
    root.innerHTML = `
      <style>
        :host { display: block; container-type: inline-size; }
        .bar { --accent: ${accent}; display: flex; align-items: stretch; position: relative;
          height: ${R(two ? 44 : 34, two ? 13 : 10, barH)}; border-radius: 12px; overflow: hidden; color: #fff;
          font-family: var(--ntc-font, system-ui, sans-serif); }
        .rail { display: none; width: 4px; background: var(--accent); }
        .badge { display: ${c.show_label ? "flex" : "none"}; align-items: center; gap: 8px; white-space: nowrap; font-weight: 500; }
        .badge.two { flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; }
        .brow { display: flex; align-items: center; gap: 8px; }
        .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; flex: 0 0 auto; }
        #label { display: inline-flex; align-items: center; justify-content: flex-start; transition: opacity .18s ease; }
        .blabel { font-size: ${R(12, 3.8, labelSize)}; }
        .measure { position: absolute; left: -9999px; top: -9999px; visibility: hidden; white-space: nowrap; }
        .binfo { display: inline-flex; align-items: baseline; }
        .binfo .ilabel { font-size: ${R(iMin, iCq, iSize)}; font-weight: 500; opacity: .62; letter-spacing: .3px; margin-right: 5px; }
        .binfo .ival { font-size: ${R(iMin, iCq, iSize)}; font-weight: 500; opacity: .95; }
        /* two-row info line under the label */
        .inforow { white-space: nowrap; transition: opacity .18s ease; }
        .inforow .ilabel { font-size: ${R(iMin, iCq, iSize)}; font-weight: 500; opacity: .6; letter-spacing: .3px; margin-right: 5px; }
        .inforow .ival { font-size: ${R(iMin, iCq, iSize)}; font-weight: 500; opacity: .95; }
        /* inline chip */
        .chip { display: flex; align-items: center; gap: 7px; padding: 0 14px; white-space: nowrap;
          background: rgba(0,0,0,.22); transition: opacity .18s ease; }
        .chip .ilabel { font-size: ${R(9, 2.4, Math.max(10, iSize))}; font-weight: 500; opacity: .7; letter-spacing: .4px; }
        .chip .ival { font-size: ${R(11, 2.8, Math.max(12, iSize + 2))}; font-weight: 500; color: var(--accent); }
        .tk { flex: 1; overflow: hidden; position: relative; display: flex; align-items: center;
          -webkit-mask-image: linear-gradient(90deg,transparent,#000 20px,#000 calc(100% - 20px),transparent);
          mask-image: linear-gradient(90deg,transparent,#000 20px,#000 calc(100% - 20px),transparent); }
        .trk { display: inline-flex; align-items: center; white-space: nowrap; will-change: transform;
          font-size: ${R(11, 4.2, fs)}; font-weight: 500; animation: ntc-scroll linear infinite; }
        .tk:hover .trk { animation-play-state: ${c.pause_on_hover ? "paused" : "running"}; }
        .headline { padding: 0 2px; }
        .sep { color: var(--accent); padding: 0 15px; }
        .status { padding: 0 18px; opacity: .7; }
        @keyframes ntc-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes ntc-pulse { 0%{box-shadow:0 0 0 0 rgba(255,255,255,.55);} 70%{box-shadow:0 0 0 7px rgba(255,255,255,0);} 100%{box-shadow:0 0 0 0 rgba(255,255,255,0);} }
        .side { display: flex; align-items: center; gap: 10px; padding: 0 12px; white-space: nowrap; }
        #clock { font-variant-numeric: tabular-nums; font-weight: 500; font-size: ${R(10, 2.4, Math.max(12, fs - 4))}; letter-spacing: .3px; }
        .toggle { display: ${c.show_lang_toggle ? "inline-flex" : "none"}; border: 1px solid rgba(255,255,255,.22);
          border-radius: 999px; overflow: hidden; font-size: ${R(9, 2, Math.max(11, fs - 7))}; font-weight: 500; cursor: pointer; user-select: none; }
        .toggle span { padding: 3px 9px; opacity: .5; }
        .toggle span.on { background: var(--accent); opacity: 1; }
        /* narrow screens (phones): reclaim width for the headlines */
        @container (max-width: 440px) {
          .secs { display: none; }
          .side { gap: 6px; padding: 0 8px; }
          .toggle span { padding: 3px 7px; }
          .sep { padding: 0 10px; }
        }

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
        .bar[data-style="live"] .trk { text-transform: uppercase; letter-spacing: .5px; color: #dfe6ee; font-size: ${R(11, 4.2, Math.max(12, fs - 3))}; }
        .bar[data-style="live"] .side { color: #6b7a88; border-left: 1px solid #1c2430; }
        .bar[data-style="live"] .chip { background: #0b0f15; }

        .bar[data-style="split"] { background: rgba(20,16,28,.6); backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%); border: 1px solid rgba(255,255,255,.08); }
        .bar[data-style="split"] .badge { padding: 0 16px; letter-spacing: .7px; background: var(--accent);
          text-transform: ${c.uppercase ? "uppercase" : "none"}; }
        .bar[data-style="split"] .badge .dot { display: none; }
        .bar[data-style="split"] .side { color: #c9c4e8; }
      </style>
      <div class="bar" data-style="${c.style}">
        <div class="rail"></div>
        <div class="badge${two ? " two" : ""}">
          ${two
            ? '<span class="brow"><span class="dot"></span><span id="label"></span></span><span class="inforow" id="info"></span>'
            : '<span class="dot"></span><span id="label"></span><span class="measure" id="measure"></span>'}
        </div>
        ${inline ? '<div class="chip" id="info"></div>' : ""}
        <div class="tk"><div class="trk" id="track"></div></div>
        <div class="side">
          <div id="clock"></div>
          <div class="toggle" id="toggle"><span data-l="en">EN</span><span data-l="ta">TA</span></div>
        </div>
      </div>`;
    this._built = true;
    this._renderForMode();
    this._syncToggle();
    const tog = root.getElementById("toggle");
    if (tog) tog.addEventListener("click", (e) => {
      const l = e.target && e.target.getAttribute("data-l");
      if (!l || l === this._lang) return;
      this._lang = l;
      try { localStorage.setItem("ntc_lang", l); } catch (err) {}
      this._renderForMode(); this._syncToggle(); this._loadNews();
    });
    this._updateTime();
    if (this._headlines) this._renderTicker();
    requestAnimationFrame(() => { if (this._mode() === "badge1") this._fitBadge(); });
    // re-fit badge width + recompute scroll duration when the card is resized
    // (window resize, phone rotation, sidebar toggle, responsive breakpoints)
    if (this._ro) this._ro.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => {
        clearTimeout(this._roT);
        this._roT = setTimeout(() => {
          if (this._mode() === "badge1") this._fitBadge();
          if (this._headlines) this._renderTicker();
        }, 150);
      });
      const bar = root.querySelector(".bar");
      if (bar) this._ro.observe(bar);
    }
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
    const opt = (label, key, val, choices) =>
      '<label class="r"><span>' + label + '</span><select data-key="' + key + '">' +
      choices.map((o) => '<option value="' + o + '"' + (val === o ? " selected" : "") + ">" + o + "</option>").join("") + "</select></label>";
    const styleSel = opt("Style", "style", c.style || "glass", NTC_STYLES);
    const sel = Array.isArray(c.info_items) ? c.info_items : [];
    const infoChecks = NTC_INFO_ALL.map((id) => '<label class="r"><span>' + (NTC_INFO_LABEL[id] || id) +
      ' <small>(' + id + ')</small></span><input data-info="' + id + '" type="checkbox" ' +
      (sel.indexOf(id) >= 0 ? "checked" : "") + "></label>").join("");
    this.shadowRoot.innerHTML = `
      <style>
        .r{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:5px 0;}
        .r span{font-size:14px;} .r small{opacity:.6;}
        .sec{margin:10px 0 2px;font-size:13px;font-weight:500;opacity:.8;border-top:1px solid var(--divider-color,#333);padding-top:8px;}
        .hint{font-size:12px;opacity:.6;margin:2px 0 0;}
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
        ${opt("Info position", "info_position", c.info_position || "badge", ["badge", "inline"])}
        ${row("Info text size (px, 0 = auto)", "info_font_size", "number", c.info_font_size != null ? c.info_font_size : 0)}
        <p class="hint">Bigger than the badge label → info drops to a 2nd row.</p>
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
