import { describe, expect, it } from "vitest";
import { XchatFormatConverter } from "./markdown";

/** Italic markers may stringify as either `*italic*` or `_italic_`. */
const ITALIC_MARKERS_RE = /[*_]italic[*_]/;

describe("XchatFormatConverter", () => {
  const converter = new XchatFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", async () => {
      const ast = await converter.toAst("Hello world");
      expect(ast.nodes.length).toBeGreaterThan(0);
    });

    it("should parse bold (**text**)", async () => {
      const ast = await converter.toAst("**bold text**");
      expect(ast.nodes).toHaveLength(1);
    });

    it("should parse italic (_text_)", async () => {
      const ast = await converter.toAst("_italic text_");
      expect(ast.nodes).toHaveLength(1);
    });

    it("should parse code blocks", async () => {
      const ast = await converter.toAst("```\ncode\n```");
      expect(ast.nodes).toHaveLength(1);
    });

    it("should parse lists", async () => {
      const ast = await converter.toAst("- item 1\n- item 2\n- item 3");
      expect(ast.nodes).toHaveLength(1);
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST", async () => {
      const ast = await converter.toAst("Hello world");
      const result = await converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should preserve bold formatting markers", async () => {
      const ast = await converter.toAst("**bold text**");
      const result = await converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should preserve italic formatting markers", async () => {
      const ast = await converter.toAst("_italic_");
      const result = await converter.fromAst(ast);
      expect(result).toMatch(ITALIC_MARKERS_RE);
    });

    it("should convert GFM tables to ASCII code blocks", async () => {
      const ast = await converter.toAst(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |"
      );
      const result = await converter.fromAst(ast);
      expect(result).toContain("```");
      expect(result).toContain("Name");
      expect(result).toContain("Age");
      expect(result).toContain("Alice");
      expect(result).toContain("30");
      // The whole table is fenced as a code block.
      expect(result.startsWith("```")).toBe(true);
      expect(result.endsWith("```")).toBe(true);
    });

    it("should roundtrip a complex message", async () => {
      const input = "Hello **world**! Here is a list:\n\n- item 1\n- item 2";
      const ast = await converter.toAst(input);
      const result = await converter.fromAst(ast);
      expect(result).toContain("Hello");
      expect(result).toContain("world");
      expect(result).toContain("item 1");
      expect(result).toContain("item 2");
    });
  });

  describe("renderPostable", () => {
    it("should render a string message", async () => {
      expect(await converter.renderPostable("Hello")).toBe("Hello");
    });

    it("should render a raw message", async () => {
      expect(await converter.renderPostable({ raw: "raw text" })).toBe(
        "raw text"
      );
    });

    it("should render a markdown message", async () => {
      const result = await converter.renderPostable({ markdown: "**bold**" });
      expect(result).toContain("bold");
    });
  });
});
