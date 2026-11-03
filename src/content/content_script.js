// The floating bubble: put on a page by the popup's "Floating button on this page" switch, and only
// on that page (it's gone when you leave the page or close the tab). A plain script, run in the
// extension's own isolated world. It's only the buttons: the service worker reads the page and
// talks to Culury (background/handlers.js), so no key ever reaches the page, and shows how it
// went in a banner at the top of the page (lib/banner.js).
(() => {
  if (window.__culuryCompanion?.present()) return window.__culuryCompanion.show();

  const SIZE = 48;
  const EDGE = 12;
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .wrap { --card: #ffffff; --ink: #1b2422; --subtle: #5b6763; --line: #dfe5e2; --action: #13803d; --ok: #13803d; --problem: #b42318; --hover: #f1f4f3; }
    @media (prefers-color-scheme: dark) {
      .wrap { --card: #1d2522; --ink: #e8eeeb; --subtle: #9aa7a2; --line: #2f3a36; --action: #3fbf6c; --ok: #4fd17c; --problem: #ff8a7a; --hover: #26302c; }
    }
    .bubble { width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; border: 0; padding: 0; cursor: grab; display: grid; place-items: center; background: #13803d; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.25); touch-action: none; }
    .bubble:active { cursor: grabbing; }
    .bubble:focus-visible { outline: 3px solid #7fd6a0; outline-offset: 2px; }
    .menu { position: absolute; width: 240px; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
    .menu { padding: 6px; display: flex; flex-direction: column; }
    .menu[hidden] { display: none; }
    .menu .title { padding: 6px 10px 4px; font-size: 12px; font-weight: 700; color: var(--subtle); }
    .menu .note { padding: 6px 10px; font-size: 13px; color: var(--problem); }
    .menu button { all: unset; display: block; padding: 8px 10px; border-radius: 8px; cursor: pointer; color: var(--ink); }
    .menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--hover); }
    .menu button:disabled { opacity: .45; cursor: not-allowed; }
    .menu .hide { color: var(--subtle); font-size: 13px; border-top: 1px solid var(--line); border-radius: 0 0 8px 8px; margin-top: 4px; }
  `;
  // The extension's mark: a leaf dropping into a tray
  const ICON = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5c2.6 1.6 3.4 5.2 1.5 7.9-1 1.4-2.6 2.1-3.9 2.3-.5-1.6-.4-3.4.5-5A7 7 0 0 1 12 2.5Z" fill="#fff"/><path d="M11 12.4c.4-2 1.2-3.6 2.3-5" stroke="#13803d" stroke-width="1"/><path d="M4 14h4.2a3.8 3.8 0 0 0 7.6 0H20v4.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V14Z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

  const host = document.createElement("div");
  host.id = "culury-companion-bubble";
  host.style.cssText = `position: fixed; z-index: 2147483647; left: ${innerWidth - SIZE - EDGE}px; top: ${Math.round(innerHeight * 0.4)}px;`;
  const root = host.attachShadow({ mode: "open" });
  // Styles that the page can't change, and that can't change the page (and work under a strict CSP)
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.append(style);
  }
  root.innerHTML += `
    <div class="wrap">
      <button class="bubble" type="button" aria-label="Culury Companion" title="Culury Companion (drag to move)" aria-haspopup="menu" aria-expanded="false">${ICON}</button>
      <div class="menu" role="menu" aria-label="Culury Companion" hidden></div>
    </div>`;
  const button = root.querySelector(".bubble");
  const menu = root.querySelector(".menu");
  document.documentElement.append(host);

  const ask = (msg) => chrome.runtime.sendMessage(msg);
  let state = null;

  // Menus and messages open beside the bubble, on the side with room
  const place = (el) => {
    const left = parseFloat(host.style.left);
    const top = parseFloat(host.style.top);
    el.style.left = left > innerWidth / 2 ? `${-240 - 8}px` : `${SIZE + 8}px`;
    el.style.top = top > innerHeight - 220 ? "auto" : "0px";
    el.style.bottom = top > innerHeight - 220 ? "0px" : "auto";
  };

  function closeMenu() {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function fillMenu() {
    menu.replaceChildren();
    const add = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      el.textContent = text;
      menu.append(el);
      return el;
    };
    add("div", "title", "Culury Companion");
    if (!state) add("div", "", "Checking Culury…").style.cssText = "padding: 6px 10px; color: var(--subtle);";
    else if (!state.ok) add("div", "note", state.problem);
    else {
      const action = (label, act, enabled = true, why = "") => {
        const b = add("button", "", label);
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.disabled = !enabled;
        if (why) b.title = why;
        b.addEventListener("click", () => run(act));
      };
      if (state.canPush) action("📬 Send to Inbox", "push");
      if (state.canImport) action(state.improve ? "⚡ Import with AI correction" : "⚡ Import", "import");
      if (!state.canPush && !state.canImport) add("div", "note", "These keys can't send anything: check them in the extension's settings.");
      if (state.always) {
        const stop = add("button", "hide", "Stop showing on this site");
        stop.type = "button";
        stop.setAttribute("role", "menuitem");
        stop.addEventListener("click", () => {
          remove();
          ask({ type: "always-off" }).catch(() => {});
        });
      }
    }
    const hide = add("button", "hide", "Hide");
    hide.type = "button";
    hide.setAttribute("role", "menuitem");
    hide.addEventListener("click", remove);
  }

  async function openMenu() {
    fillMenu();
    place(menu);
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (!state) {
      state = await ask({ type: "bubble-state" }).catch(() => ({ ok: false, problem: "Culury Companion was updated: switch the floating button on again from the toolbar." }));
      if (!menu.hidden) fillMenu();
    }
    menu.querySelector("button:not(:disabled)")?.focus();
  }

  // The worker does it, and a banner at the top of the page says how it went
  function run(action) {
    closeMenu();
    ask({ type: "act", action }).catch(() => alertGone());
  }
  // The extension was updated or reloaded since the button was put here: it can't reach it any more
  function alertGone() {
    remove();
    console.info("Culury Companion was updated: switch the floating button on again from the toolbar.");
  }

  function remove() {
    host.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  }

  // ---------- dragging: anywhere, then it sticks to the nearest side ----------
  let drag = null;
  let dragged = false;
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, left: parseFloat(host.style.left), top: parseFloat(host.style.top), moved: false };
    button.setPointerCapture?.(e.pointerId);
  });
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    closeMenu();
    host.style.left = `${Math.min(Math.max(drag.left + dx, 0), innerWidth - SIZE)}px`;
    host.style.top = `${Math.min(Math.max(drag.top + dy, 0), innerHeight - SIZE)}px`;
  };
  const up = () => {
    if (!drag) return;
    if (drag.moved) {
      dragged = true; // the click that follows a drag isn't a click
      const left = parseFloat(host.style.left);
      host.style.left = `${left + SIZE / 2 < innerWidth / 2 ? EDGE : innerWidth - SIZE - EDGE}px`;
    }
    drag = null;
  };
  addEventListener("pointermove", move, true);
  addEventListener("pointerup", up, true);
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerup", up);
  button.addEventListener("click", () => {
    if (dragged) return void (dragged = false);
    if (menu.hidden) void openMenu();
    else closeMenu();
  });

  // ---------- closing the menu ----------
  const outside = (e) => !e.composedPath().includes(host) && closeMenu();
  const onKey = (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      closeMenu();
      button.focus();
    }
  };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", onKey, true);

  // For the popup's switch: is it here, take it away, bring it back into view
  window.__culuryCompanion = {
    present: () => host.isConnected,
    remove,
    show: () => {
      host.style.top = `${Math.min(parseFloat(host.style.top), innerHeight - SIZE)}px`;
      button.focus();
    },
  };
})();
