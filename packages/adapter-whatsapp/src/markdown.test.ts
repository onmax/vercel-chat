import { emphasis, paragraph, root, text } from "chat";
import { describe, expect, it } from "vitest";
import { WhatsAppFormatConverter } from "./markdown";

describe("WhatsAppFormatConverter", () => {
  const converter = new WhatsAppFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", async () => {
      const ast = await converter.toAst("Hello world");
      expect(ast.nodes.length).toBeGreaterThan(0);
    });

    it("should parse WhatsApp bold (*text*) as standard bold", async () => {
      const ast = await converter.toAst("*bold text*");
      expect(ast.nodes).not.toHaveLength(0);
    });

    it("should parse italic (_text_)", async () => {
      const ast = await converter.toAst("_italic text_");
      expect(ast.nodes).not.toHaveLength(0);
    });

    it("should parse WhatsApp strikethrough (~text~) as standard", async () => {
      const ast = await converter.toAst("~strikethrough~");
      expect(ast.nodes).not.toHaveLength(0);
    });

    it("should not merge bold spans across newlines", async () => {
      const ast = await converter.toAst("*bold1*\nsome text\n*bold2*");
      const result = converter.fromAst(ast);
      // Each bold span should remain separate, not merge into one
      expect(result).toContain("*bold1*");
      expect(result).toContain("*bold2*");
    });

    it("should parse code blocks", async () => {
      const ast = await converter.toAst("```\ncode\n```");
      expect(ast.nodes).not.toHaveLength(0);
    });

    it("preserves code starting immediately after the opening fence", async () => {
      // From sample-messages.md: WhatsApp puts the first code line right
      // after the ```, which CommonMark would read as an info string.
      const ast = await converter.toAst(
        "Here you go:\n```first line\nsecond line```"
      );
      expect(ast.nodes[0]).toEqual(["p", {}, "Here you go:"]);
      expect(ast.nodes[1]).toEqual([
        "pre",
        {},
        ["code", {}, "first line\nsecond line"],
      ]);
    });

    it("does not rewrite bold or strikethrough inside fenced code", async () => {
      const ast = await converter.toAst("```int *a = *b; ~x~```");
      expect(ast.nodes[0]).toEqual([
        "pre",
        {},
        ["code", {}, "int *a = *b; ~x~"],
      ]);
    });

    it("keeps an unpaired ``` as literal text", async () => {
      const ast = await converter.toAst("use ``` to fence *code*");
      expect(ast.nodes).toHaveLength(1);
      expect(ast.nodes[0]).toEqual(expect.arrayContaining(["p"]));
    });

    it("separates a fence from surrounding text on the same line", async () => {
      const ast = await converter.toAst("before ```code``` after");
      const tags = ast.nodes.map((node) => Array.isArray(node) && node[0]);
      expect(tags).toEqual(["p", "pre", "p"]);
    });

    it("should parse lists", async () => {
      const ast = await converter.toAst("- item 1\n- item 2\n- item 3");
      expect(ast.nodes).not.toHaveLength(0);
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST", async () => {
      const ast = await converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should convert standard bold to WhatsApp bold", async () => {
      // Create AST from standard markdown with double asterisks
      const ast = await converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      // Should output WhatsApp-style single asterisk bold
      expect(result).toContain("*bold text*");
      expect(result).not.toContain("**bold text**");
    });

    it("should convert standard strikethrough to WhatsApp style", async () => {
      const ast = await converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
      expect(result).not.toContain("~~strikethrough~~");
    });

    it("should preserve escaped asterisks and tildes as literals", async () => {
      const ast = await converter.toAst("a \\* b and c \\~ d");
      const result = converter.fromAst(ast);
      expect(result).toBe("a * b and c ~ d");
    });

    it("should convert standard italic to WhatsApp underscore italic", async () => {
      // Standard markdown _italic_ renders as emphasis in the AST.
      // WhatsApp uses *text* for bold, so emphasis must become _text_.
      const result = await converter.renderPostable({
        markdown: "_italic text_",
      });
      expect(result).toContain("_italic text_");
      expect(result).not.toContain("*italic text*");
    });

    it("should handle bold and italic together", async () => {
      const result = await converter.renderPostable({
        markdown: "**bold** and _italic_",
      });
      expect(result).toContain("*bold*");
      expect(result).toContain("_italic_");
    });

    it("should convert headings to bold text", async () => {
      const ast = await converter.toAst("# Main heading");
      const result = converter.fromAst(ast);
      expect(result).toContain("*Main heading*");
      expect(result).not.toContain("#");
    });

    it("should flatten bold inside headings to avoid triple asterisks", async () => {
      const result = await converter.renderPostable({
        markdown: "## **Choose React if:**",
      });
      expect(result).toContain("*Choose React if:*");
      expect(result).not.toContain("***");
    });

    it("should handle headings with mixed text and bold", async () => {
      const result = await converter.renderPostable({
        markdown: "# The Honest Answer: **It Depends!** 🤷‍♂️",
      });
      expect(result).toContain("*The Honest Answer: It Depends! 🤷‍♂️*");
      expect(result).not.toContain("**");
    });

    it("should convert thematic breaks to text separator", async () => {
      const ast = await converter.toAst("above\n\n---\n\nbelow");
      const result = converter.fromAst(ast);
      expect(result).toContain("━━━");
      expect(result).toContain("above");
      expect(result).toContain("below");
    });

    it("should convert tables to code blocks", async () => {
      const ast = await converter.toAst("| A | B |\n| --- | --- |\n| 1 | 2 |");
      const result = converter.fromAst(ast);
      // Should be in a code block, not raw pipe syntax
      expect(result).toContain("```");
    });
  });

  describe("renderPostable", () => {
    it.each([
      ["(~80 % easy)", "(~80 % easy)"],
      ["~45 min, Pace ~6:29/km", "~45 min, Pace ~6:29/km"],
      [
        String.raw`C:\Users\Luis and foo_bar`,
        String.raw`C:\Users\Luis and foo_bar`,
      ],
      [
        String.raw`A backslash before a tilde: \\\~80`,
        String.raw`A backslash before a tilde: \~80`,
      ],
      [String.raw`Literal \*\*stars\*\*`, String.raw`Literal \*\*stars\*\*`],
      [String.raw`\_init\_ and \~gone\~`, String.raw`\_init\_ and \~gone\~`],
      ["foo_bar_baz", "foo_bar_baz"],
      [String.raw`a \* b and c \~ d`, "a * b and c ~ d"],
      ["*un*believable", "_un_believable"],
      ["line one  \nline two", "line one\nline two"],
      [String.raw`\> not a quote`, String.raw`\> not a quote`],
      [String.raw`1\. not a list`, String.raw`1\. not a list`],
      [String.raw`\- not a bullet`, String.raw`\- not a bullet`],
      [String.raw`\* not a bullet`, String.raw`\* not a bullet`],
      ["soft break\n\\> not a quote", "soft break\n\\> not a quote"],
      ["`~80 **literal** ~~literal~~`", "`~80 **literal** ~~literal~~`"],
      [
        "```\n~80 **literal** ~~literal~~ C:\\Users\\Luis\n```",
        "```\n~80 **literal** ~~literal~~ C:\\Users\\Luis\n```",
      ],
      [
        "- **Monday** — Rest\n- _Tuesday_ — ~~Tempo~~",
        "- *Monday* — Rest\n- _Tuesday_ — ~Tempo~",
      ],
      ["**bold _italic_ ~~strike~~**", "*bold _italic_ ~strike~*"],
      ["_use snake_case here_", "_use snake_case here_"],
      ["**2 * 3 = 6**", "*2 * 3 = 6*"],
      ["~~rate ~5 per day~~", "~rate ~5 per day~"],
      ["_a_b_c_", "_a_b_c_"],
      [String.raw`**\*b**`, String.raw`*\*b*`],
      [String.raw`_\_x_`, String.raw`_\_x_`],
      [String.raw`~~y\~~~`, String.raw`~y\~~`],
      [String.raw`**see \_this\_ too**`, String.raw`*see \_this\_ too*`],
    ])("preserves literal text and formatting in %s", async (markdown, expected) => {
      expect(await converter.renderPostable({ markdown })).toBe(expected);
    });

    it("renders emphasis without character references", async () => {
      const ast = root([
        paragraph([text("x"), emphasis([text(" spaced ")]), text("y")]),
      ]);
      expect(await converter.renderPostable({ ast })).not.toContain("&#x");
      expect(
        await converter.renderPostable({ markdown: "*un*believable" })
      ).not.toContain("&#x");
    });

    it("renders deeply nested formatting", async () => {
      let markdown = "end";
      let expected = "end";
      for (let depth = 0; depth < 23; depth++) {
        const marker = depth % 2 === 0 ? "*" : "~";
        markdown = `text ${marker}${marker}${markdown} end${marker}${marker}`;
        expected = `text ${marker}${expected} end${marker}`;
      }

      expect(await converter.renderPostable({ markdown })).toBe(expected);
    });

    it("should render a plain string", async () => {
      const result = await converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", async () => {
      const result = await converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render a markdown message", async () => {
      const result = await converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("bold");
    });

    it("should render an AST message", async () => {
      const ast = await converter.toAst("Hello from AST");
      const result = await converter.renderPostable({ ast });
      expect(result).toContain("Hello from AST");
    });

    it("should correctly convert a complex AI-style markdown response", async () => {
      const markdown = [
        "# The Answer: **It Depends!**",
        "",
        "There's no universal *better* choice.",
        "",
        "## **Choose React if:**",
        "- Building **large-scale** apps",
        "- Need the biggest *ecosystem*",
        "- **Examples:** Facebook, Netflix",
        "",
        "## **Choose Vue if:**",
        "- Want *faster* learning curve",
        "- Prefer ~~complex~~ cleaner templates",
        "",
        "---",
        "",
        "## Real Talk:",
        "**All three are excellent.** Learn *React* first!",
      ].join("\n");

      const result = await converter.renderPostable({ markdown });

      expect(result).toBe(`*The Answer: It Depends!*

There's no universal _better_ choice.

*Choose React if:*

- Building *large-scale* apps
- Need the biggest _ecosystem_
- *Examples:* Facebook, Netflix

*Choose Vue if:*

- Want _faster_ learning curve
- Prefer ~complex~ cleaner templates

━━━

*Real Talk:*

*All three are excellent.* Learn _React_ first!`);
    });
  });
});

describe("parseIncoming", () => {
  const converter = new WhatsAppFormatConverter();
  const markers = "_a".repeat(2100);

  it("keeps text inside a fence closed inline as code", async () => {
    const input = `\`\`\`\n${markers}\`\`\``;
    const { formatted } = await converter.parseIncoming(input);
    expect(formatted).toEqual(await converter.toAst(input));
    expect(formatted.nodes).toEqual([["pre", {}, ["code", {}, markers]]]);
  });
});
