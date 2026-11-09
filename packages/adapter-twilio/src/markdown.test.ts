import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { TwilioFormatConverter } from "./markdown";

describe("TwilioFormatConverter", () => {
  const converter = new TwilioFormatConverter();

  it("keeps raw strings plain", async () => {
    expect(await converter.renderPostable("hello")).toBe("hello");
  });

  it("converts markdown to Twilio text", async () => {
    expect(await converter.renderPostable({ markdown: "**hello**" })).toBe(
      "**hello**"
    );
  });

  it("renders tables as ascii blocks", async () => {
    const text = await converter.fromAst(
      await parseMarkdown("| name | age |\n| --- | --- |\n| Ada | 36 |")
    );

    expect(text).toContain("name | age");
    expect(text).not.toContain("| --- |");
  });
});
