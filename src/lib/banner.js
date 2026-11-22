// A message at the top of the page you're on ("Sent to your RecipeHub inbox", "Imported …"), after the
// popup or the floating button did something. Runs in the page (chrome.scripting.executeScript
// passes this function by itself, so it must not use anything from outside it). It fades out by
// itself; "busy" stays until the next one replaces it.
//   state: "ok", "problem" or "busy". link: a recipe to open.
export function showBanner(text, state = "ok", link) {
  const ID = "recipehub-companion-banner";
  const old = document.getElementById(ID);
  if (old) {
    clearTimeout(old.__timer);
    old.remove();
  }
  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position: fixed; z-index: 2147483647; top: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px);";
  const root = host.attachShadow({ mode: "open" });
  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 600 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .bar { --bg: #ffffff; --ink: #1b2422; --ok: #13803d; --problem: #b42318; --subtle: #5b6763; --line: #dfe5e2;
      display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; border-radius: 12px; border: 1px solid var(--line);
      background: var(--bg); color: var(--ink); box-shadow: 0 8px 24px rgba(0,0,0,.18); transition: opacity .4s, transform .4s; }
    @media (prefers-color-scheme: dark) { .bar { --bg: #1d2522; --ink: #e8eeeb; --ok: #4fd17c; --problem: #ff8a7a; --subtle: #9aa7a2; --line: #2f3a36; } }
    @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
    .bar.out { opacity: 0; transform: translateY(-8px); }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: var(--ok); }
    [data-state="problem"] .dot { background: var(--problem); }
    [data-state="busy"] .dot { background: var(--subtle); animation: pulse 1s infinite alternate; }
    @keyframes pulse { to { opacity: .3; } }
    [role=status] a { margin-left: 8px; color: var(--ok); text-decoration: underline; }
    button { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; color: var(--subtle); font-size: 18px; }
    button:hover { background: rgba(127,127,127,.15); }
  `;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
  }
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.dataset.state = state;
  const dot = document.createElement("span");
  dot.className = "dot";
  const msg = document.createElement("span");
  msg.setAttribute("role", "status");
  msg.dataset.state = state;
  msg.textContent = text; // text from RecipeHub: never read as HTML
  if (link) {
    const a = document.createElement("a");
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Open the recipe";
    msg.append(a);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  bar.append(dot, msg, close);
  root.append(bar);
  document.documentElement.append(host);

  const fade = () => {
    bar.classList.add("out");
    host.__timer = setTimeout(() => host.remove(), 400);
  };
  close.addEventListener("click", () => {
    clearTimeout(host.__timer);
    fade();
  });
  // busy: until the answer replaces it (a minute at most)
  host.__timer = setTimeout(fade, state === "busy" ? 60_000 : state === "problem" ? 8000 : link ? 6000 : 4000);
  bar.addEventListener("mouseenter", () => clearTimeout(host.__timer));
  bar.addEventListener("mouseleave", () => (host.__timer = setTimeout(fade, 2500)));
}
