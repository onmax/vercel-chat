import { describe, expect, it } from "vitest";
import { GmailFormatConverter } from "./markdown";

describe("Gmail formatting", () => {
  const formatter = new GmailFormatConverter();

  it("treats incoming email text literally", async () => {
    const result = await formatter.toAst("*literal* <person@example.com>");
    expect(result.nodes).toEqual([["p", {}, "*literal* <person@example.com>"]]);
  });

  it("renders canonical Markdown without treating raw messages as Markdown", async () => {
    expect(await formatter.renderPostable({ markdown: "**hello**" })).toBe(
      "**hello**"
    );
    expect(await formatter.renderPostable({ raw: "a_b" })).toBe("a_b");
  });
});
