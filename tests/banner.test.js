import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showBanner } from "../src/lib/banner.js";

// The message at the top of the page after Send to Inbox or Import (from the popup or the floating
// button). Runs in the page (chrome.scripting.executeScript), so it can't use anything outside it.
const host = () => document.getElementById("recipehub-companion-banner");
const text = () => host().shadowRoot.querySelector("[role=status]");

beforeEach(() => {
  vi.useFakeTimers();
  document.querySelectorAll("#recipehub-companion-banner").forEach((b) => b.remove());
});
afterEach(() => vi.useRealTimers());

describe("the banner at the top of the page", () => {
  it("says it was added, then fades out by itself", () => {
    showBanner("Sent to your RecipeHub inbox", "ok");
    expect(text().textContent).toContain("Sent to your RecipeHub inbox");
    expect(text().dataset.state).toBe("ok");
    vi.advanceTimersByTime(3900);
    expect(host()).toBeTruthy();
    vi.advanceTimersByTime(1200); // 4 seconds, then the fade
    expect(host()).toBeNull();
  });

  it("one at a time: the next one replaces it (Importing… then Imported)", () => {
    showBanner("Importing…", "busy");
    vi.advanceTimersByTime(20_000);
    expect(host()).toBeTruthy(); // waiting stays until the answer
    showBanner("Imported “Pork Roast” into RecipeHub", "ok", "http://192.168.1.20:5173/#/recipes/31");
    expect(document.querySelectorAll("#recipehub-companion-banner")).toHaveLength(1);
    const link = text().querySelector("a");
    expect(link.textContent).toBe("Open the recipe");
    expect(link.href).toBe("http://192.168.1.20:5173/#/recipes/31");
    expect(link.target).toBe("_blank");
  });

  it("a problem stays longer, and can be closed", () => {
    showBanner("Can't reach RecipeHub", "problem");
    expect(text().dataset.state).toBe("problem");
    vi.advanceTimersByTime(6000);
    expect(host()).toBeTruthy();
    host().shadowRoot.querySelector("button[aria-label='Close']").click();
    vi.advanceTimersByTime(500);
    expect(host()).toBeNull();
  });

  it("text from RecipeHub is shown as text, never as HTML", () => {
    showBanner('Imported “<img src=x onerror=alert(1)>”', "ok");
    expect(text().querySelector("img")).toBeNull();
    expect(text().textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
