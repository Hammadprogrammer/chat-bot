/*! Multi-Site AI Chatbot widget. Usage:
 *  <script src="https://YOUR-APP/widget.js" data-chatbot-key="pk_xxx" async></script>
 */
(function () {
  "use strict";
  if (window.__msChatbotLoaded) return;
  window.__msChatbotLoaded = true;

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[data-chatbot-key]');
    return s[s.length - 1];
  })();
  if (!script) return;
  var KEY = script.getAttribute("data-chatbot-key");
  if (!KEY) return console.error("[chatbot] Missing data-chatbot-key attribute");
  var BASE = (script.getAttribute("data-api-base") || script.src.replace(/\/widget\.js.*$/, "")).replace(/\/$/, "");

  var STORAGE_VISITOR = "msbot:visitor";
  var STORAGE_CONV = "msbot:conv:" + KEY;
  var visitorId = store(STORAGE_VISITOR) || store(STORAGE_VISITOR, rand());
  var conversationId = store(STORAGE_CONV) || null;
  var cfg = null, open = false, busy = false, host, root, els = {};

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v); return v;
    } catch (e) { return v || null; }
  }
  function rand() { return "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* Minimal safe markdown: bold, italics, inline code, links, lists, line breaks. */
  function md(src) {
    var s = esc(src);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    var lines = s.split("\n"), out = "", inList = false;
    lines.forEach(function (l) {
      var m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) { if (!inList) { out += "<ul>"; inList = true; } out += "<li>" + m[1] + "</li>"; }
      else { if (inList) { out += "</ul>"; inList = false; } if (l.trim()) out += "<p>" + l + "</p>"; }
    });
    if (inList) out += "</ul>";
    return out;
  }

  /* Relative luminance of a hex color (0 = black, 1 = white). */
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 0;
    var n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var lin = function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function css(c) {
    var pos = c.position === "left" ? "left" : "right";
    var light = luminance(c.primaryColor) > 0.6;         /* white / yellow / pastel brand colors */
    var fg = light ? "#111827" : "#fff";                 /* text + icons on primary surfaces */
    var fgMuted = light ? "rgba(17,24,39,.65)" : "rgba(255,255,255,.85)";
    var edge = light ? "1px solid rgba(0,0,0,.12)" : "0";/* outline so light surfaces stand out on white pages */
    var bubbleBg = light ? "#e8ecf3" : c.primaryColor;   /* user bubble: soft grey when primary is too light */
    var bubbleFg = light ? "#111827" : "#fff";
    var avBg = light ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.25)";
    return "\
:host{all:initial}*{box-sizing:border-box}\
.l{position:fixed;bottom:20px;" + pos + ":20px;z-index:2147483000;display:flex;align-items:center;gap:10px;height:64px;padding:0 20px 0 12px;border:" + edge + ";border-radius:28px;background:" + c.primaryColor + ";color:" + fg + ";font:600 15px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18);transition:transform .15s}\
.l:hover{transform:scale(1.04)}.l svg{width:26px;height:26px;fill:" + fg + "}.l img{width:48px;height:48px;border-radius:50%;object-fit:cover;background:#fff}.l.no-text{width:64px;height:64px;padding:0;justify-content:center;overflow:hidden}.l.no-text img{width:100%;height:100%;border-radius:50%}\
.w{position:fixed;bottom:96px;" + pos + ":20px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 110px);display:none;flex-direction:column;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 16px 48px rgba(0,0,0,.22);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111}\
.w.open{display:flex;animation:in .18s ease-out}@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}\
.h{display:flex;align-items:center;gap:10px;padding:14px 16px;background:" + c.primaryColor + ";color:" + fg + ";border-bottom:" + edge + "}\
.h img,.h .av{width:40px;height:40px;border-radius:50%;background:" + avBg + ";display:flex;align-items:center;justify-content:center;font-weight:700;object-fit:cover}\
.h .t{flex:1;font-weight:600;font-size:15px}.h .t small{display:block;font-weight:400;color:" + fgMuted + ";font-size:12px}\
.h button{background:transparent;border:0;color:" + fg + ";font-size:22px;line-height:1;cursor:pointer;opacity:.9;padding:4px}\
.m{flex:1;overflow-y:auto;padding:16px;background:#f6f7f9;display:flex;flex-direction:column;gap:10px}\
.b{max-width:85%;padding:10px 13px;border-radius:14px;word-wrap:break-word}\
.b p{margin:0 0 6px}.b p:last-child{margin:0}.b ul{margin:4px 0 4px 18px;padding:0}.b code{background:rgba(0,0,0,.07);padding:1px 4px;border-radius:4px;font-size:13px}.b a{color:inherit;text-decoration:underline}\
.u{align-self:flex-end;background:" + bubbleBg + ";color:" + bubbleFg + ";border-bottom-right-radius:4px}\
.a{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}\
.s{font-size:12px;color:#6b7280;margin-top:6px}.s a{color:#374151;margin-right:8px}\
.typing span{display:inline-block;width:6px;height:6px;margin-right:3px;border-radius:50%;background:#9ca3af;animation:bl 1.2s infinite}.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}@keyframes bl{0%,80%,100%{opacity:.3}40%{opacity:1}}\
.ho{align-self:flex-start;background:#fff;border:1px dashed #d1d5db;border-radius:12px;padding:12px;width:85%}\
.ho h4{margin:0 0 6px;font-size:13px}.ho p{margin:0 0 8px;font-size:13px;color:#4b5563}\
.ho input,.ho textarea{width:100%;margin-bottom:6px;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font:inherit;font-size:13px}\
.ho textarea{resize:vertical;min-height:56px}\
.btn{display:inline-block;padding:8px 14px;border:" + edge + ";border-radius:8px;background:" + c.primaryColor + ";color:" + fg + ";font:600 13px system-ui,sans-serif;cursor:pointer;text-decoration:none}.btn.alt{background:#fff;color:#111;border:1px solid #d1d5db;margin-left:6px}\
.f{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}\
.f textarea{flex:1;resize:none;overflow-y:auto;max-height:120px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;outline:none;scrollbar-width:none}.f textarea::-webkit-scrollbar{display:none}\
.f textarea:focus{border-color:" + (light ? "#9ca3af" : c.primaryColor) + "}\
.f button{width:42px;border:" + edge + ";border-radius:10px;background:" + c.primaryColor + ";color:" + fg + ";cursor:pointer;display:flex;align-items:center;justify-content:center}.f button:disabled{opacity:.5;cursor:default}.f button svg{width:18px;height:18px;fill:" + fg + "}\
.p{text-align:center;font-size:11px;color:#9ca3af;padding:4px 0 8px;background:#fff}\
.err{color:#b91c1c;font-size:12px;padding:0 16px 8px;background:#fff}\
@media(max-width:480px){.w{bottom:0;" + pos + ":0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}";
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';

  function mount(c) {
    cfg = c;
    host = el("div", { id: "ms-chatbot-host" });
    root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.appendChild(el("style", { text: css(c) }));

    var launcherIcon = c.avatarUrl ? '<img src="' + esc(c.avatarUrl) + '" alt="">' : ICON_CHAT;
    els.launcher = el("button", { class: "l" + (c.launcherText ? "" : " no-text"), "aria-label": "Open chat", html: launcherIcon + (c.launcherText ? "<span>" + esc(c.launcherText) + "</span>" : ""), onclick: toggle });
    els.msgs = el("div", { class: "m", role: "log", "aria-live": "polite" });
    els.input = el("textarea", { rows: "1", placeholder: "Type your message…", "aria-label": "Message", onkeydown: function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }, oninput: autosize });
    els.sendBtn = el("button", { type: "button", "aria-label": "Send", html: ICON_SEND, onclick: send });
    els.error = el("div", { class: "err", hidden: "" });

    var avatar = c.avatarUrl ? el("img", { src: c.avatarUrl, alt: "" }) : el("div", { class: "av", text: (c.botName || "A").charAt(0).toUpperCase() });
    els.win = el("div", { class: "w", role: "dialog", "aria-label": c.botName }, [
      el("div", { class: "h" }, [avatar, el("div", { class: "t", html: esc(c.botName) + "<small>Online · typically replies instantly</small>" }), el("button", { "aria-label": "Close", text: "×", onclick: toggle })]),
      els.msgs,
      els.error,
      el("div", { class: "f" }, [els.input, els.sendBtn]),
      c.poweredBy ? el("div", { class: "p", text: c.poweredByText || "Powered by AI Chatbot" }) : null,
    ]);
    root.appendChild(els.win);
    root.appendChild(els.launcher);
    document.body.appendChild(host);
    bubble("a", c.welcomeMessage);
  }

  function autosize() { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px"; }
  function toggle() { open = !open; els.win.classList.toggle("open", open); if (open) setTimeout(function () { els.input.focus(); scroll(); }, 50); }
  function scroll() { els.msgs.scrollTop = els.msgs.scrollHeight; }
  function bubble(kind, text, sources) {
    var b = el("div", { class: "b " + kind, html: kind === "a" ? md(text) : esc(text) });
    if (sources && sources.length) {
      var s = el("div", { class: "s", text: "Sources: " });
      sources.forEach(function (src) { s.appendChild(src.url ? el("a", { href: src.url, target: "_blank", rel: "noopener noreferrer", text: src.title }) : el("span", { text: src.title + " " })); });
      b.appendChild(s);
    }
    els.msgs.appendChild(b); scroll(); return b;
  }
  function showError(msg) { els.error.textContent = msg; els.error.hidden = !msg; }

  function post(path, body) {
    return fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); return j; }); });
  }

  function send() {
    var text = els.input.value.trim();
    if (!text || busy) return;
    busy = true; els.sendBtn.disabled = true; showError("");
    els.input.value = ""; autosize();
    bubble("u", text);
    var typing = el("div", { class: "b a typing", html: "<span></span><span></span><span></span>" });
    els.msgs.appendChild(typing); scroll();
    post("/api/chat", { key: KEY, message: text, conversationId: conversationId, visitorId: visitorId, pageUrl: location.href })
      .then(function (res) {
        typing.remove();
        conversationId = res.conversationId; store(STORAGE_CONV, conversationId);
        bubble("a", res.answer, res.sources);
        if (res.handoff) handoffCard(res.handoff, text);
      })
      .catch(function (e) { typing.remove(); showError(e.message || "Something went wrong. Please try again."); })
      .then(function () { busy = false; els.sendBtn.disabled = false; els.input.focus(); });
  }

  function handoffCard(h, lastQuestion) {
    var card = el("div", { class: "ho" }, [el("h4", { text: "Need more help?" }), el("p", { text: "Leave your email and our team will follow up with you." })]);
    var actions = el("div");
    if (h.supportEmail || cfg.handoffEnabled) {
      var name = el("input", { placeholder: "Your name (optional)", "aria-label": "Name" });
      var email = el("input", { type: "email", placeholder: "Your email", "aria-label": "Email", required: "" });
      var msg = el("textarea", { placeholder: "How can we help?", "aria-label": "Message" }); msg.value = lastQuestion || "";
      var submit = el("button", { class: "btn", text: "Contact support", onclick: function () {
        if (!email.value) { email.focus(); return; }
        submit.disabled = true;
        post("/api/handoff", { key: KEY, conversationId: conversationId, name: name.value, email: email.value, message: msg.value, pageUrl: location.href })
          .then(function (r) { card.innerHTML = "<p>" + esc(r.message) + "</p>"; })
          .catch(function (e) { submit.disabled = false; showError(e.message); });
      } });
      card.appendChild(name); card.appendChild(email); card.appendChild(msg); actions.appendChild(submit);
    }
    if (h.supportUrl) actions.appendChild(el("a", { class: "btn alt", href: h.supportUrl, target: "_blank", rel: "noopener noreferrer", text: "Open support" }));
    card.appendChild(actions);
    els.msgs.appendChild(card); scroll();
  }

  function init() {
    fetch(BASE + "/api/widget/config?key=" + encodeURIComponent(KEY))
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); })
      .then(mount)
      .catch(function (e) { console.error("[chatbot] " + (e && e.message ? e.message : "failed to load")); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.MSChatbot = { open: function () { if (!open) toggle(); }, close: function () { if (open) toggle(); }, toggle: toggle };
})();
