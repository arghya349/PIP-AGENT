// Pip's dock: Pip standing in the corner, one speech bubble, and small choice
// cards. content.js decides WHAT Pip says; this file only shows it.
//
//   show({ key, text, choices, input, list, prio, ttl, anim, loose })
//     prio 5 menu · 4 error (err: true) · 3 question · 2 live status · 1 event · 0 chatter
//     A question (choices or input) waits until it's answered; a statement
//     fades after `ttl` ms. A newer item with the same `key` updates in place.
//   setLive(item | null)  a pinned status shown whenever nothing else is
//   setBase(anim)         Pip's looping mood; play(anim) a one-shot over it
(() => {
  if (globalThis.PipDock) return;
  const FPS = 12;
  const PX = 2.6;

  const CSS = `
  .pipdock { position: fixed; bottom: 92px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; font: 13.5px/1.4 "Google Sans", system-ui, -apple-system, sans-serif;
    --paper: #fffaf3; --ink: #2e2d2a; --soft: #77716a; --pink: #e6a0ac; --pink-ink: #4a2a31; --ok: #3f8f5a; --bad: #c4473a; --rule: #e4d9cc; }
  @media (prefers-color-scheme: dark) {
    .pipdock { --paper: #23201d; --ink: #f1e9df; --soft: #aaa196; --pink: #e6a0ac; --pink-ink: #2a1418; --ok: #6fcf8f; --bad: #ff8a7a; --rule: #3b3631; }
  }
  .pipdock.right { right: 18px; align-items: flex-end; }
  .pipdock.left { left: 18px; align-items: flex-start; }
  .pipdock[hidden] { display: none; }
  .pip-btn { all: unset; cursor: pointer; display: block; line-height: 0; border-radius: 12px; filter: drop-shadow(0 4px 6px rgba(0,0,0,.18)); transition: transform .12s; }
  .pip-btn:hover { transform: translateY(-2px); }
  .pip-btn:active { transform: translateY(1px) scale(.97); }
  .pip-btn:focus-visible { outline: 2px dashed var(--ink); outline-offset: 3px; }
  .pip-btn canvas { display: block; }

  .bubble { position: relative; box-sizing: border-box; width: max-content; min-width: 150px; max-width: min(290px, calc(100vw - 40px)); padding: 11px 13px 12px;
    background: var(--paper); color: var(--ink); border: 1.5px solid var(--ink); border-radius: 10px; box-shadow: 3px 3px 0 var(--ink); animation: pop .22s cubic-bezier(.3,1.6,.6,1); }
  .bubble[hidden] { display: none; }
  .bubble:focus { outline: none; }
  .bubble::after { content: ""; position: absolute; bottom: -7px; width: 11px; height: 11px; background: var(--paper); border-right: 1.5px solid var(--ink); border-bottom: 1.5px solid var(--ink); transform: rotate(45deg); }
  .right .bubble::after { right: 34px; }
  .left .bubble::after { left: 34px; }
  .bubble.live { border-style: dashed; }
  .bubble.err { border-color: var(--bad); box-shadow: 3px 3px 0 var(--bad); }
  .bubble.err::after { border-color: var(--bad); }
  @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.96); } }
  .kicker { font: 600 10.5px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--soft); margin: 0 0 5px; }
  .say { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
  .bubble:not(.live) .say, .bubble:not(.live) .kicker { padding-right: 16px; }
  .x { all: unset; position: absolute; top: 4px; right: 7px; cursor: pointer; color: var(--soft); font-size: 15px; line-height: 1; padding: 2px; }
  .x:hover { color: var(--ink); }
  .x:focus-visible { outline: 1px dashed var(--ink); }

  .cards { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
  .card { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 7px; border: 1.5px solid var(--ink); border-radius: 8px; background: var(--paper); color: var(--ink);
    font: 600 12.5px/1.2 inherit; box-shadow: 2px 2px 0 var(--ink); transition: transform .08s, box-shadow .08s; animation: rise .25s backwards; }
  .card:nth-child(2) { animation-delay: .04s; } .card:nth-child(3) { animation-delay: .08s; } .card:nth-child(4) { animation-delay: .12s; } .card:nth-child(5) { animation-delay: .16s; }
  .card:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 var(--ink); }
  .card:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--ink); }
  .card:focus-visible { outline: 2px dashed var(--ink); outline-offset: 2px; }
  .card.hot { background: var(--pink); color: var(--pink-ink); }
  .card .n { font: 600 10px/1 ui-monospace, Menlo, monospace; opacity: .55; }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } }

  .ask { display: flex; gap: 6px; margin-top: 9px; }
  .ask input { flex: 1; min-width: 0; box-sizing: border-box; border: 1.5px solid var(--ink); border-radius: 8px; background: transparent; color: var(--ink); padding: 7px 9px; font: 13px inherit; outline: none; }
  .ask input:focus { box-shadow: 2px 2px 0 var(--pink); }
  .ask input::placeholder { color: var(--soft); }

  .log { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; max-height: 150px; overflow-y: auto; font: 11.5px/1.35 ui-monospace, Menlo, monospace; color: var(--soft); }
  .log li.ok::before { content: "✓ "; color: var(--ok); }
  .log li.bad::before { content: "✗ "; color: var(--bad); }
  .log li.run::before { content: "▸ "; color: var(--ink); }
  .log .empty { font-style: italic; }
  @media (prefers-reduced-motion: reduce) { .bubble, .card { animation: none; } .pip-btn { transition: none; } }`;

  /** Pip drawn on a canvas: a looping base mood, with one-shots played over it. */
  function sprite(canvas) {
    const P = globalThis.PipEngine;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = P.GRID * PX;
    canvas.width = Math.ceil(size * dpr);
    canvas.height = Math.ceil(size * dpr);
    canvas.style.width = canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let base = "idle", shot = null, start = performance.now(), seed = Math.random() * 1000, lastFrame = -1, flip = false, shotTimer = 0;
    let pointer = null;
    addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }), { passive: true });

    const current = () => P.ANIMS[shot || base] || P.ANIMS.idle;
    const restart = () => { start = performance.now(); seed = Math.random() * 1000; lastFrame = -1; };
    function endShot() { clearTimeout(shotTimer); shot = null; restart(); }

    function render(now) {
      const a = current();
      let t = (now - start) / 1000;
      if (a.duration && t >= a.duration) { if (shot) { endShot(); return requestAnimationFrame(render); } t = a.duration - 0.001; }
      const frame = Math.floor(t * FPS);
      if (frame !== lastFrame) {
        lastFrame = frame;
        const p = a.frame(still ? 0 : frame / FPS, seed);
        if (pointer && (p.eyes === "open" || p.eyes === "focus") && !shot) {
          const r = canvas.getBoundingClientRect();
          const dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height * 0.4);
          if (Math.hypot(dx, dy) > 30) {
            p.lookX = (Math.abs(dx) > Math.abs(dy) * 0.5 ? Math.sign(dx) : 0) * (flip ? -1 : 1);
            p.lookY = Math.abs(dy) > Math.abs(dx) * 0.5 ? Math.sign(dy) : 0;
          }
        }
        const g = P.compose(p);
        const mirror = flip && (shot || base) !== "point"; // point turns toward the side panel, beside the page
        P.paint(ctx, mirror ? g.map((row) => [...row].reverse()) : g, PX);
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    return {
      setBase(name) { if (name === base) return; base = name; if (!shot) restart(); },
      play(name) {
        const a = P.ANIMS[name];
        if (!a) return;
        shot = name; restart();
        // one-shots also end on a timer: a hidden tab draws no frames
        clearTimeout(shotTimer);
        shotTimer = setTimeout(endShot, (a.duration || 2) * 1000 + 200);
      },
      face(left) { if (flip !== left) { flip = left; lastFrame = -1; } },
    };
  }

  globalThis.PipDock = function createDock(root, { onTap, side = "right" } = {}) {
    const style = document.createElement("style");
    style.textContent = CSS;
    const dock = document.createElement("div");
    dock.className = "pipdock " + side;
    // built with DOM calls, never HTML strings: Gemini's Trusted Types policy blocks innerHTML
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    bubble.hidden = true;
    bubble.tabIndex = -1; // a click on the bubble focuses it, so 1–9 pick a card
    const btn = document.createElement("button");
    btn.className = "pip-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Pip. Open Pip's menu");
    const canvas = document.createElement("canvas");
    btn.append(canvas);
    dock.append(bubble, btn);
    root.append(style, dock);
    const pip = sprite(canvas);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let engaged = false; // the last click was on Pip or its bubble
    let cur = null, live = null, queue = [], ttlTimer = 0, typeTimer = 0, hushed = false, seq = 0, curSide = side, wanted = "idle";
    const isQuestion = (it) => !!(it && (it.choices?.length || it.input));
    const sticky = (it) => !!it && !it.live && !it.loose && isQuestion(it);
    const faceFor = () => pip.face(curSide === "right"); // look toward the chat

    function render(fresh) {
      clearTimeout(ttlTimer);
      clearTimeout(typeTimer);
      if (!cur) { bubble.hidden = true; bubble.replaceChildren(); return; }
      const it = cur;
      const hadFocus = engaged || dock.contains(root.activeElement); // keep 1–9 working after a re-render
      bubble.hidden = false;
      bubble.className = "bubble" + (it.live ? " live" : "") + (it.err ? " err" : "");
      bubble.setAttribute("role", it.err ? "alert" : "status");
      bubble.replaceChildren();
      if (it.kicker) bubble.append(el("p", "kicker", it.kicker));
      const say = el("p", "say", "");
      bubble.append(say);
      if (!it.live) {
        const x = el("button", "x", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Close");
        x.addEventListener("click", () => dismiss());
        bubble.append(x);
      }
      if (it.list) {
        const ul = el("ol", "log");
        if (!it.list.length) ul.append(el("li", "empty", "nothing yet"));
        for (const r of it.list) ul.append(el("li", r.cls || "", r.text));
        bubble.append(ul);
      }
      let input = null;
      if (it.input) {
        const row = el("form", "ask");
        input = document.createElement("input");
        input.type = "text";
        input.maxLength = 1000;
        input.placeholder = it.input.placeholder || "";
        input.value = it.input.value || "";
        const go = el("button", "card hot", it.input.button || "Go");
        go.type = "submit";
        row.append(input, go);
        row.addEventListener("submit", (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (!v && !it.input.allowEmpty) return input.focus();
          const r = it.input.submit(v);
          if (r && typeof r === "object") replaceWith(r); else if (r !== false) dismiss(true);
        });
        bubble.append(row);
      }
      if (it.choices?.length) {
        const cards = el("div", "cards");
        it.choices.forEach((c, i) => {
          const b = el("button", "card" + (c.hot ?? i === 0 ? " hot" : ""), "");
          b.type = "button";
          if (it.choices.length > 1) b.append(el("span", "n", String(i + 1)));
          b.append(document.createTextNode(c.label));
          b.addEventListener("click", () => choose(i));
          cards.append(b);
        });
        bubble.append(cards);
      }
      // Pip "speaks" the line: typed fast, unless it's an update or motion is reduced
      const text = it.text || "";
      if (!fresh || still || text.length > 160) say.textContent = text;
      else {
        let n = 0;
        const tick = () => { n = Math.min(text.length, n + 2); say.textContent = text.slice(0, n); if (n < text.length) typeTimer = setTimeout(tick, 14); };
        tick();
      }
      if (fresh && it.anim) pip.play(it.anim);
      if (input && fresh) setTimeout(() => input.focus(), 30);
      else if (hadFocus && !dock.contains(root.activeElement)) bubble.focus();
      const ttl = it.ttl ?? (it.list ? 0 : 6500);
      if (!isQuestion(it) && !it.live && ttl) ttlTimer = setTimeout(() => dismiss(), ttl);
    }

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }

    function choose(i) {
      const it = cur, c = it?.choices?.[i];
      if (!c) return;
      const r = c.pick?.();
      if (r && typeof r === "object") replaceWith(r);
      else if (!c.keep && cur === it) dismiss(true);
    }
    function replaceWith(item) { cur = null; show(item); }
    function dismiss() { next(); }
    function next() {
      // a statement that waited too long is old news
      queue = queue.filter((q) => isQuestion(q) || Date.now() - q.at < 8000);
      cur = queue.shift() || live || null;
      render(true);
    }

    function show(item) {
      const it = { prio: 1, ...item, id: ++seq, at: Date.now() };
      if (hushed && it.prio < 3) return;
      if (cur && it.key && cur.key === it.key) { cur = it; render(false); return; } // update in place
      queue = queue.filter((q) => !(it.key && q.key === it.key));
      if (!cur || cur.live || it.prio > cur.prio || (it.prio === cur.prio && !isQuestion(cur))) {
        if (sticky(cur)) queue.unshift(cur);
        cur = it;
        render(true);
      } else {
        queue.push(it);
        queue.sort((a, b) => b.prio - a.prio);
      }
    }
    function close(key) {
      if (key && cur?.key !== key) { queue = queue.filter((q) => q.key !== key); return; }
      if (cur) next();
    }
    const sig = (it) => (it ? `${it.kicker}|${it.text}` : "");
    function setLive(item) {
      const wasShowing = !!cur?.live, same = sig(item) === sig(live);
      live = item ? { ...item, live: true, prio: 2 } : null;
      if (wasShowing && same && live) { cur = live; return; } // unchanged: keep the cards under the pointer
      if (!cur || wasShowing) { cur = live || queue.shift() || null; render(!wasShowing); }
    }

    btn.addEventListener("click", () => onTap?.());
    dock.addEventListener("keydown", (e) => {
      const typing = e.target instanceof HTMLInputElement;
      e.stopPropagation(); // keep the chat page's shortcuts out of Pip
      if (e.key === "Escape") { if (cur && !cur.live) dismiss(); btn.focus(); return; }
      if (!typing && /^[1-9]$/.test(e.key) && cur?.choices?.length) { e.preventDefault(); choose(Number(e.key) - 1); }
    });
    for (const t of ["keyup", "keypress", "input"]) dock.addEventListener(t, (e) => e.stopPropagation());
    // a click outside closes what isn't waiting for an answer
    document.addEventListener("pointerdown", (e) => {
      engaged = e.composedPath().includes(dock);
      if (!cur || cur.live || sticky(cur) || e.composedPath().includes(dock)) return;
      dismiss();
    }, true);
    faceFor();

    return {
      show, close, setLive,
      current: () => cur,
      isOpen: (key) => !!cur && (!key || cur.key === key),
      play: (a) => pip.play(a),
      setBase(a) { wanted = a; pip.setBase(hushed ? "sleep" : a); },
      hush(on) {
        hushed = on;
        pip.setBase(on ? "sleep" : wanted);
        if (on) { queue = queue.filter((q) => q.prio >= 3); if (cur && !cur.live && cur.prio < 3) next(); }
      },
      get hushed() { return hushed; },
      setSide(s) { curSide = s; dock.className = "pipdock " + s; faceFor(); },
      setHidden(h) { dock.hidden = h; },
      setBottom(px) { dock.style.bottom = Math.round(px) + "px"; }, // stay clear of the chat's message box
      focus: () => btn.focus(),
    };
  };
})();
