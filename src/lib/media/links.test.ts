import { describe, expect, it } from "vitest";
import { extractLinks } from "./links";

describe("extractLinks", () => {
  it("finds two urls in the same message", () => {
    const links = extractLinks(
      "Olha isso https://exemplo.com/a e também https://outro.com/b",
    );

    expect(links.map((l) => l.url)).toEqual([
      "https://exemplo.com/a",
      "https://outro.com/b",
    ]);
    expect(links[0]?.domain).toBe("exemplo.com");
  });

  it("handles a message that is only a url", () => {
    const links = extractLinks("https://exemplo.com/doc.pdf");

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("https://exemplo.com/doc.pdf");
    expect(links[0]?.domain).toBe("exemplo.com");
    // No surrounding text — the title stays empty.
    expect(links[0]?.title).toBe("");
  });

  it("keeps the text around the url as the title", () => {
    const links = extractLinks("olha a planilha https://exemplo.com/p.xlsx");

    expect(links[0]?.title).toBe("olha a planilha https://exemplo.com/p.xlsx");
  });

  it("returns nothing for a text without a url", () => {
    expect(extractLinks("só um texto")).toEqual([]);
    expect(extractLinks("")).toEqual([]);
    expect(extractLinks(null)).toEqual([]);
    expect(extractLinks(undefined)).toEqual([]);
  });

  it("ignores mailto: and tel:", () => {
    expect(extractLinks("mailto:a@b.com")).toEqual([]);
    expect(extractLinks("tel:+5511999999999")).toEqual([]);
  });

  it("dedupes the same url written two ways", () => {
    const links = extractLinks(
      "https://www.exemplo.com/a e https://exemplo.com/a de novo",
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("https://www.exemplo.com/a");
  });

  it("drops the sentence punctuation from the end of a url", () => {
    const links = extractLinks("veja https://exemplo.com/a.");

    expect(links[0]?.url).toBe("https://exemplo.com/a");
  });

  it("keeps urls that differ in path apart", () => {
    const links = extractLinks(
      "https://exemplo.com/a https://exemplo.com/b",
    );

    expect(links).toHaveLength(2);
  });
});
