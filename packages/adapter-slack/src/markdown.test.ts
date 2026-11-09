import { getNodeTag, paragraph, root, strong, toPlainText } from "chat";
import { describe, expect, it } from "vitest";
import { SlackFormatConverter } from "./markdown";

describe("SlackFormatConverter", () => {
  const converter = new SlackFormatConverter();

  describe("toMarkdown (mrkdwn -> markdown)", () => {
    it.each([
      "cost is 2 * 3 seats and 4 * 5 licenses",
      "run `rm -rf *` then 5 * 3",
      "keep `*star* ~strike~` literal",
    ])("preserves literal content in %s", async (text) => {
      expect(toPlainText(await converter.toAst(text))).toBe(
        text.replaceAll("`", "")
      );
    });

    it("retains bold around literal inline code", async () => {
      const ast = await converter.toAst("*before `*code*` after*");

      expect(ast.nodes[0]).toEqual([
        "p",
        {},
        ["strong", {}, "before ", ["code", {}, "*code*"], " after"],
      ]);
    });

    it.each([
      ["mailto:a*b*c@example.com", "email"],
      ["mailto:a~b~c@example.com", "email"],
      ["mailto:user@example.com", "https://example.com"],
      ["tel:+15551234567", "https://example.com"],
      ["mailto:user@example.com", "support ] desk"],
      ["mailto:user@example.com?subject=(help)", "support"],
    ])("preserves link destination %s and label %s", async (url, label) => {
      const ast = await converter.toAst(`<${url}|${label}>`);

      expect(ast.nodes[0]).toEqual(["p", {}, ["a", { href: url }, label]]);
      expect(toPlainText(ast)).toBe(label);
    });

    it("preserves code starting immediately after the opening fence", async () => {
      const ast = await converter.toAst("```first line\nsecond line\n```");

      expect(ast.nodes[0]).toEqual([
        "pre",
        {},
        ["code", {}, "first line\nsecond line"],
      ]);
      expect(toPlainText(ast)).toBe("first line\nsecond line");
    });

    it("parses a code block pasted into a message", async () => {
      // From sample-messages.md: a fence with a first line, mid-message.
      const ast = await converter.toAst(
        "Here you go:\n```first line\nsecond line```"
      );

      expect(getNodeTag(ast.nodes[0])).toBe("p");
      expect(ast.nodes[1]).toEqual([
        "pre",
        {},
        ["code", {}, "first line\nsecond line"],
      ]);
    });

    it("does not swallow text after an unpaired fence", async () => {
      const ast = await converter.toAst("use ``` to fence code, *see*?");

      expect(ast.nodes).toHaveLength(1);
      expect(getNodeTag(ast.nodes[0])).toBe("p");
      expect(toPlainText(ast)).toBe("use ``` to fence code, see?");
    });

    it("keeps a quoted fence inside the blockquote", async () => {
      const ast = await converter.toAst("&gt; a ```c``` b");

      expect(ast.nodes).toHaveLength(1);
      expect(getNodeTag(ast.nodes[0])).toBe("blockquote");
      expect(toPlainText(ast)).toBe("a c b");
    });

    it("keeps trailing text after a code block as a paragraph", async () => {
      const ast = await converter.toAst("```x``` &gt; note");

      expect(ast.nodes[0]).toEqual(["pre", {}, ["code", {}, "x"]]);
      expect(getNodeTag(ast.nodes[1])).toBe("p");
      expect(toPlainText(ast)).toBe("x\n\n> note");
    });

    it("keeps code content verbatim inside the fence", async () => {
      const ast = await converter.toAst("```int *a = *b;```");

      expect(ast.nodes[0]).toEqual(["pre", {}, ["code", {}, "int *a = *b;"]]);
    });

    it("should convert bold", async () => {
      expect(await converter.toMarkdown("Hello *world*!")).toContain(
        "**world**"
      );
    });

    it("should convert strikethrough", async () => {
      expect(await converter.toMarkdown("Hello ~world~!")).toContain(
        "~~world~~"
      );
    });

    it("should convert links with text", async () => {
      const result = await converter.toMarkdown(
        "Check <https://example.com|this>"
      );
      expect(result).toContain("[this](https://example.com)");
    });

    it("should convert bare links", async () => {
      const result = await converter.toMarkdown("Visit <https://example.com>");
      expect(result).toContain("https://example.com");
    });

    it("should convert user mentions", async () => {
      const result = await converter.toMarkdown("Hey <@U123|john>!");
      expect(result).toContain("@john");
    });

    it("should convert channel mentions", async () => {
      const result = await converter.toMarkdown("Join <#C123|general>");
      expect(result).toContain("#general");
    });

    it("should convert bare channel ID mentions", async () => {
      const result = await converter.toMarkdown("Join <#C123>");
      expect(result).toContain("#C123");
    });
  });

  describe("toSlackPayload", () => {
    it("routes plain strings to text (preserves literal markdown chars)", async () => {
      expect(await converter.toSlackPayload("Use *foo* literally")).toEqual({
        text: "Use *foo* literally",
      });
    });

    it("routes raw strings to text", async () => {
      expect(
        await converter.toSlackPayload({ raw: "*already mrkdwn*" })
      ).toEqual({
        text: "*already mrkdwn*",
      });
    });

    it("routes markdown to markdown_text", async () => {
      expect(
        await converter.toSlackPayload({ markdown: "## Heading\n\n- a\n- b" })
      ).toEqual({ markdown_text: "## Heading\n\n- a\n- b" });
    });

    it("routes ast to markdown_text via stringifyMarkdown", async () => {
      const ast = root([paragraph([strong(["bold"])])]);
      const result = await converter.toSlackPayload({ ast });
      expect(result).toHaveProperty("markdown_text");
      expect((result as { markdown_text: string }).markdown_text).toContain(
        "**bold**"
      );
    });

    it("preserves tables when rendering ast to markdown_text", async () => {
      const ast = root([
        [
          "table",
          {},
          ["thead", {}, ["tr", {}, ["th", {}, "A"], ["th", {}, "B"]]],
          ["tbody", {}, ["tr", {}, ["td", {}, "1"], ["td", {}, "2"]]],
        ],
      ]);
      const result = await converter.toSlackPayload({ ast });
      expect(result).toHaveProperty("markdown_text");
      const text = (result as { markdown_text: string }).markdown_text;
      expect(text).toContain("| A   | B   |");
      expect(text).toContain("| 1   | 2   |");
    });
  });

  describe("toResponseUrlText", () => {
    it("renders markdown to Slack mrkdwn text", async () => {
      expect(
        await converter.toResponseUrlText({
          markdown: "**Bold** and [link](https://example.com)",
        })
      ).toBe("*Bold* and <https://example.com|link>");
    });

    it("renders markdown tables as ASCII code blocks", async () => {
      expect(
        await converter.toResponseUrlText({
          markdown: "| A | B |\n|---|---|\n| 1 | 2 |",
        })
      ).toContain("```\n");
    });
  });

  describe("mentions", () => {
    it("does not double-wrap existing <@U123> mentions in plain strings", async () => {
      expect(
        await converter.toSlackPayload("Hey <@U12345>. Please select")
      ).toEqual({
        text: "Hey <@U12345>. Please select",
      });
    });

    it("does not double-wrap existing mentions in markdown", async () => {
      expect(
        await converter.toSlackPayload({
          markdown: "Hey <@U12345>. Please select",
        })
      ).toEqual({ markdown_text: "Hey <@U12345>. Please select" });
    });

    it("rewrites bare @mentions in plain strings", async () => {
      expect(
        await converter.toSlackPayload("Hey @george. Please select")
      ).toEqual({
        text: "Hey <@george>. Please select",
      });
    });

    it("rewrites bare @mentions in markdown", async () => {
      expect(
        await converter.toSlackPayload({
          markdown: "Hey @george. Please select",
        })
      ).toEqual({ markdown_text: "Hey <@george>. Please select" });
    });

    it("does not mangle email addresses in plain strings", async () => {
      expect(
        await converter.toSlackPayload("Contact user@example.com for help")
      ).toEqual({ text: "Contact user@example.com for help" });
    });

    it("does not mangle mailto links", async () => {
      expect(
        await converter.toSlackPayload("Email <mailto:user@example.com>")
      ).toEqual({ text: "Email <mailto:user@example.com>" });
    });

    it("converts mentions adjacent to non-word punctuation", async () => {
      expect(await converter.toSlackPayload("(cc @george, @anne)")).toEqual({
        text: "(cc <@george>, <@anne>)",
      });
    });

    it("does not mangle @handles inside URL paths in plain strings", async () => {
      expect(
        await converter.toSlackPayload(
          "See https://hackmd.io/@jkyang/B1W69XA-fe"
        )
      ).toEqual({ text: "See https://hackmd.io/@jkyang/B1W69XA-fe" });
    });

    it("does not mangle @handles inside URL paths in markdown", async () => {
      expect(
        await converter.toSlackPayload({
          markdown: "See https://mastodon.social/@user for updates",
        })
      ).toEqual({
        markdown_text: "See https://mastodon.social/@user for updates",
      });
    });

    it("does not mangle @handles inside URL query strings", async () => {
      expect(
        await converter.toSlackPayload(
          "Profile https://example.com/p?user=@george"
        )
      ).toEqual({ text: "Profile https://example.com/p?user=@george" });
    });

    it("does not mangle @handles inside URL fragments", async () => {
      expect(
        await converter.toSlackPayload("Jump https://example.com/docs#@george")
      ).toEqual({ text: "Jump https://example.com/docs#@george" });
    });

    it("does not mangle @handles inside Slack links", async () => {
      expect(
        await converter.toSlackPayload(
          "See <https://example.com/p?user=@george|George's profile>"
        )
      ).toEqual({
        text: "See <https://example.com/p?user=@george|George's profile>",
      });
    });

    it("does not mangle @handles inside Markdown links", async () => {
      expect(
        await converter.toSlackPayload({
          markdown: "See [profile](https://example.com/p?user=@george)",
        })
      ).toEqual({
        markdown_text: "See [profile](https://example.com/p?user=@george)",
      });
    });

    it("does not link @handles inside inline code", async () => {
      expect(
        await converter.toSlackPayload(
          "Use `@vercel/postgres` and ping @george"
        )
      ).toEqual({
        text: "Use `@vercel/postgres` and ping <@george>",
      });
    });

    it("does not link @handles inside fenced code", async () => {
      expect(
        await converter.toSlackPayload({
          markdown:
            "Install:\n```\nnpm install @vercel/postgres\n```\ncc @george",
        })
      ).toEqual({
        markdown_text:
          "Install:\n```\nnpm install @vercel/postgres\n```\ncc <@george>",
      });
    });

    it("does not mangle @handles inside schemeless host paths", async () => {
      expect(
        await converter.toSlackPayload("See hackmd.io/@jkyang/abc")
      ).toEqual({
        text: "See hackmd.io/@jkyang/abc",
      });
    });

    it("rewrites slash-separated mentions", async () => {
      expect(await converter.toSlackPayload("cc @george/@anne")).toEqual({
        text: "cc <@george>/<@anne>",
      });
    });

    it("rewrites mentions after schemeless host punctuation", async () => {
      expect(await converter.toSlackPayload("See example.com,@george")).toEqual(
        {
          text: "See example.com,<@george>",
        }
      );
    });

    it("still rewrites a real mention that follows a URL", async () => {
      expect(
        await converter.toSlackPayload(
          "See https://hackmd.io/@jkyang/abc cc @george"
        )
      ).toEqual({
        text: "See https://hackmd.io/@jkyang/abc cc <@george>",
      });
    });

    it("preserves schemeless URL handles in response URL markdown", async () => {
      expect(
        await converter.toResponseUrlText({
          markdown: "See hackmd.io/@jkyang/abc cc @george",
        })
      ).toBe("See hackmd.io/@jkyang/abc cc <@george>");
    });

    it("handles malformed angle text without rescanning it", async () => {
      const prefix = "<".repeat(20_000);
      expect(
        await converter.toSlackPayload(
          `${prefix} https://example.com/@jkyang cc @george`
        )
      ).toEqual({
        text: `${prefix} https://example.com/@jkyang cc <@george>`,
      });
    });
  });

  describe("toPlainText", () => {
    it("should remove bold markers", async () => {
      expect(await converter.toPlainText("Hello *world*!")).toBe(
        "Hello world!"
      );
    });

    it("should remove italic markers", async () => {
      expect(await converter.toPlainText("Hello _world_!")).toBe(
        "Hello world!"
      );
    });

    it("should extract link text", async () => {
      expect(
        await converter.toPlainText("Check <https://example.com|this>")
      ).toBe("Check this");
    });

    it("should format user mentions", async () => {
      const result = await converter.toPlainText("Hey <@U123>!");
      expect(result).toContain("@U123");
    });

    it("should handle complex messages", async () => {
      const input =
        "*Bold* and _italic_ with <https://x.com|link> and <@U123|user>";
      const result = await converter.toPlainText(input);
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).toContain("user");
      expect(result).not.toContain("*");
      expect(result).not.toContain("<");
    });
  });
});
