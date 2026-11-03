import { beforeEach, describe, expect, it } from "vitest";
import { readPage } from "../src/lib/page.js";

// Runs inside the page (chrome.scripting.executeScript): the text you'd highlighted, and the
// recipe the page carries for search engines (JSON-LD), if any
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("reading the page you're on", () => {
  it("finds the recipe, alone, in a list, or in a @graph", () => {
    const recipe = { "@type": "Recipe", name: "Pork Roast", recipeIngredient: ["1 pork butt"] };
    document.head.innerHTML = ld({ "@type": "WebSite", name: "Example" }) + ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, recipe] });
    expect(JSON.parse(readPage().recipe)).toEqual(recipe);
    document.head.innerHTML = ld([{ "@type": "Organization" }, { "@type": ["Recipe", "NewsArticle"], name: "Chili" }]);
    expect(JSON.parse(readPage().recipe).name).toBe("Chili");
  });

  it("no recipe, or JSON that doesn't parse: none", () => {
    document.head.innerHTML = ld({ "@type": "Article" }) + '<script type="application/ld+json">{not json</script>';
    expect(readPage().recipe).toBeUndefined();
  });

  it("the highlighted text", () => {
    document.body.innerHTML = "<p id=p>Brine the pork overnight in salt and sugar.</p>";
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("p"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    expect(readPage().selection).toBe("Brine the pork overnight in salt and sugar.");
  });

  it("a huge recipe is left out rather than cut off", () => {
    document.head.innerHTML = ld({ "@type": "Recipe", name: "Big", text: "x".repeat(950_000) });
    expect(readPage().recipe).toBeUndefined();
  });
});
