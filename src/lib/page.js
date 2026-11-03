// Runs inside the web page you're on (chrome.scripting.executeScript passes this function by
// itself, so it must not use anything from outside it): the text you'd highlighted, and the recipe
// the page carries for search engines (JSON-LD), so Culury can read it even if the site blocks it.
export function readPage() {
  const MAX = 900_000; // the inbox takes 1 MB of text; a recipe bigger than this is left out
  const isRecipe = (o) => {
    const t = o && typeof o === "object" ? o["@type"] : null;
    return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
  };
  const find = (o) => {
    if (!o || typeof o !== "object") return null;
    if (Array.isArray(o)) {
      for (const x of o) {
        const r = find(x);
        if (r) return r;
      }
      return null;
    }
    if (isRecipe(o)) return o;
    return find(o["@graph"]);
  };
  let recipe;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = find(JSON.parse(s.textContent));
      if (found) {
        const text = JSON.stringify(found);
        if (text.length <= MAX) recipe = text;
        break;
      }
    } catch {
      /* not JSON: skip it */
    }
  }
  const selection = String(getSelection?.() ?? "").trim().slice(0, 20_000) || undefined;
  return { recipe, selection, title: document.title || undefined };
}
