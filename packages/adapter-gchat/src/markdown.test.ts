import { describe, expect, it } from "vitest";
import { GoogleChatFormatConverter } from "./markdown";

describe("GoogleChatFormatConverter", () => {
  const converter = new GoogleChatFormatConverter();

  describe("fromAst (AST -> Google Chat format)", () => {
    it("should convert bold (**text** -> *text*)", async () => {
      const ast = await converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("*bold text*");
    });

    it("should convert italic", async () => {
      const ast = await converter.toAst("_italic text_");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic text_");
    });

    it("should convert strikethrough (~~text~~ -> ~text~)", async () => {
      const ast = await converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
    });

    it("should preserve inline code", async () => {
      const ast = await converter.toAst("Use `const x = 1`");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x = 1`");
    });

    it("should handle code blocks", async () => {
      const input = "```\nconst x = 1;\n```";
      const ast = await converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("```");
      expect(output).toContain("const x = 1;");
    });

    it("should output URL directly when link text matches URL", async () => {
      const ast = await converter.toAst(
        "[https://example.com](https://example.com)"
      );
      const result = converter.fromAst(ast);
      expect(result).toContain("https://example.com");
    });

    it("should output Google Chat custom link syntax when link text differs", async () => {
      const ast = await converter.toAst("[click here](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("<https://example.com|click here>");
    });

    it("collapses mailto autolink for plain email text", async () => {
      const ast = await converter.toAst("hello@example.com");

      const result = converter.fromAst(ast);

      expect(result).toBe("hello@example.com");
    });

    it("preserves custom label for mailto links", async () => {
      const ast = await converter.toAst("[contact](mailto:hello@example.com)");

      const result = converter.fromAst(ast);

      expect(result).toBe("<mailto:hello@example.com|contact>");
    });

    it("formats http links correctly", async () => {
      const input = "https://example.com";

      const ast = await converter.toAst(input);
      const output = converter.fromAst(ast);

      expect(output).toBe("https://example.com");
    });

    it("keeps phone numbers as plain text", async () => {
      const input = "+1555123456";

      const ast = await converter.toAst(input);
      const output = converter.fromAst(ast);

      expect(output).toBe("+1555123456");
    });

    it("collapses tel autolink for plain phone text", async () => {
      const ast = await converter.toAst("[+1555123456](tel:+1555123456)");

      const result = converter.fromAst(ast);

      expect(result).toBe("+1555123456");
    });

    it("should handle blockquotes", async () => {
      const ast = await converter.toAst("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("> quoted text");
    });

    it("should handle unordered lists with bullet points", async () => {
      const ast = await converter.toAst("- item 1\n- item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("item 1");
      expect(result).toContain("item 2");
    });

    it("should handle ordered lists", async () => {
      const ast = await converter.toAst("1. first\n2. second");
      const result = converter.fromAst(ast);
      expect(result).toContain("1.");
      expect(result).toContain("2.");
    });

    it("should indent nested unordered lists", async () => {
      const result = await converter.fromMarkdown(
        "- parent\n  - child 1\n  - child 2"
      );
      expect(result).toBe("• parent\n  • child 1\n  • child 2");
    });

    it("should indent nested ordered lists", async () => {
      const result = await converter.fromMarkdown(
        "1. first\n   1. sub-first\n   2. sub-second\n2. second"
      );
      expect(result).toContain("1. first");
      expect(result).toContain("  1. sub-first");
      expect(result).toContain("  2. sub-second");
      expect(result).toContain("2. second");
    });

    it("should handle deeply nested lists", async () => {
      const result = await converter.fromMarkdown(
        "- level 1\n  - level 2\n    - level 3"
      );
      expect(result).toContain("• level 1");
      expect(result).toContain("  • level 2");
      expect(result).toContain("    • level 3");
    });

    it("should keep sibling items at the same indent level", async () => {
      const result = await converter.fromMarkdown(
        "- item 1\n- item 2\n- item 3"
      );
      expect(result).toBe("• item 1\n• item 2\n• item 3");
    });

    it("should handle mixed ordered and unordered nesting", async () => {
      const result = await converter.fromMarkdown(
        "1. first\n   - sub a\n   - sub b\n2. second"
      );
      expect(result).toContain("1. first");
      expect(result).toContain("  • sub a");
      expect(result).toContain("  • sub b");
      expect(result).toContain("2. second");
    });

    it("should handle line breaks", async () => {
      const ast = await converter.toAst("line1  \nline2");
      const result = converter.fromAst(ast);
      expect(result).toContain("line1");
      expect(result).toContain("line2");
    });

    it("should handle thematic breaks", async () => {
      const ast = await converter.toAst("text\n\n---\n\nmore");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
    });
  });

  describe("toAst (Google Chat format -> AST)", () => {
    it("parses native bold, italic, and strikethrough as formatting nodes", async () => {
      expect((await converter.toAst("*bold* _italic_ ~struck~")).nodes).toEqual(
        [
          [
            "p",
            {},
            ["strong", {}, "bold"],
            " ",
            ["em", {}, "italic"],
            " ",
            ["del", {}, "struck"],
          ],
        ]
      );
    });

    it("parses code blocks with their literal content", async () => {
      expect((await converter.toAst("```\ncode\n```")).nodes).toEqual([
        ["pre", {}, ["code", {}, "code"]],
      ]);
    });
  });

  describe("extractPlainText", () => {
    it("should remove formatting markers", async () => {
      const result = await converter.extractPlainText(
        "*bold* _italic_ ~struck~"
      );
      expect(result).toBe("bold italic struck");
    });

    it("should handle empty string", async () => {
      expect(await converter.extractPlainText("")).toBe("");
    });

    it("should handle plain text", async () => {
      expect(await converter.extractPlainText("Hello world")).toBe(
        "Hello world"
      );
    });

    it("should handle inline code", async () => {
      const result = await converter.extractPlainText("Use `const x = 1`");
      expect(result).toContain("const x = 1");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", async () => {
      const result = await converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", async () => {
      const result = await converter.renderPostable({ raw: "raw text" });
      expect(result).toBe("raw text");
    });

    it("should render a markdown message", async () => {
      const result = await converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("bold");
    });

    it("should render an AST message", async () => {
      const ast = await converter.toAst("**bold**");
      const result = await converter.renderPostable({ ast });
      expect(result).toContain("bold");
    });
  });

  describe("table rendering", () => {
    it("should render markdown tables as code blocks", async () => {
      const result = await converter.fromMarkdown(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |"
      );
      expect(result).toContain("```");
      expect(result).toContain("Name");
      expect(result).toContain("Alice");
    });
  });
});

describe("parseIncoming", () => {
  const converter = new GoogleChatFormatConverter();

  it("parses many single-asterisk bold runs", async () => {
    const input = "*a* ".repeat(1000).trim();
    const { formatted } = await converter.parseIncoming(input);
    expect(formatted).toEqual(await converter.toAst(input));
    const [paragraph] = formatted.nodes;
    expect(
      Array.isArray(paragraph) &&
        paragraph.slice(2).filter((node) => node[0] === "strong")
    ).toHaveLength(1000);
  });
});
