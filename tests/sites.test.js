import { describe, expect, it } from "vitest";
import { fakeChrome } from "./fakeChrome.js";
import { addSite, listSites, removeSite, siteOf, syncSites } from "../src/lib/sites.js";

// "Always show on this site": the sites where the floating button appears by itself
describe("a site", () => {
  it("is a page's address down to its host", () => {
    expect(siteOf("https://www.seriouseats.com/the-food-lab-best-chili-recipe?x=1#top")).toBe("https://www.seriouseats.com");
    expect(siteOf("http://192.168.1.20:5173/#/recipes")).toBe("http://192.168.1.20:5173");
    expect(siteOf("chrome://newtab/")).toBeNull();
    expect(siteOf("not a url")).toBeNull();
  });
});

describe("the list of sites", () => {
  it("adding asks the browser for that site only, then the button loads there by itself", async () => {
    const { chrome, granted, registered } = fakeChrome({});
    expect(await addSite("https://www.seriouseats.com", chrome)).toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ["https://www.seriouseats.com/*"] });
    expect(granted.has("https://www.seriouseats.com/*")).toBe(true);
    expect(await listSites(chrome)).toEqual(["https://www.seriouseats.com"]);
    expect([...registered.values()]).toEqual([{ id: "always-show", matches: ["https://www.seriouseats.com/*"], js: ["src/content/content_script.js"], runAt: "document_idle", persistAcrossSessions: true }]);
  });

  it("refused by the browser: not added", async () => {
    const { chrome, registered } = fakeChrome({ allow: false });
    expect(await addSite("https://www.seriouseats.com", chrome)).toBe(false);
    expect(await listSites(chrome)).toEqual([]);
    expect(registered.size).toBe(0);
  });

  it("several, A–Z, each once", async () => {
    const { chrome, registered } = fakeChrome({});
    await addSite("https://www.seriouseats.com", chrome);
    await addSite("https://cooking.nytimes.com", chrome);
    await addSite("https://www.seriouseats.com", chrome);
    expect(await listSites(chrome)).toEqual(["https://cooking.nytimes.com", "https://www.seriouseats.com"]);
    expect(registered.get("always-show").matches).toEqual(["https://cooking.nytimes.com/*", "https://www.seriouseats.com/*"]);
  });

  it("removing gives the permission back, and the last one leaves nothing registered", async () => {
    const { chrome, granted, registered } = fakeChrome({});
    await addSite("https://www.seriouseats.com", chrome);
    await removeSite("https://www.seriouseats.com", chrome);
    expect(await listSites(chrome)).toEqual([]);
    expect(granted.has("https://www.seriouseats.com/*")).toBe(false);
    expect(registered.size).toBe(0);
  });

  it("RecipeHub's own address keeps its permission (the extension needs it to reach RecipeHub)", async () => {
    const { chrome, granted } = fakeChrome({ stored: { address: "http://192.168.1.20:5173" } });
    await addSite("http://192.168.1.20:5173", chrome);
    await removeSite("http://192.168.1.20:5173", chrome);
    expect(chrome.permissions.remove).not.toHaveBeenCalled();
    expect(granted.has("http://192.168.1.20:5173/*")).toBe(true);
  });

  it("a site whose access was taken away in the browser's settings drops off the list", async () => {
    const { chrome, granted, registered } = fakeChrome({});
    await addSite("https://www.seriouseats.com", chrome);
    await addSite("https://cooking.nytimes.com", chrome);
    granted.delete("https://cooking.nytimes.com/*");
    await syncSites(chrome);
    expect(await listSites(chrome)).toEqual(["https://www.seriouseats.com"]);
    expect(registered.get("always-show").matches).toEqual(["https://www.seriouseats.com/*"]);
  });
});
