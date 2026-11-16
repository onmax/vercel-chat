import { describe, expect, it } from "vitest";
import { LinearFormatConverter } from "./markdown";

describe("LinearFormatConverter", () => {
  const converter = new LinearFormatConverter();

  describe("toAst", () => {
    it("preserves formatting, links, code, and lists in inbound markdown", async () => {
      const ast = await converter.toAst(
        "**bold** _italic_ [link](https://example.com)\n\n```ts\ncode\n```\n\n- ~~removed~~"
      );
      expect(ast.nodes).toEqual([
        [
          "p",
          {},
          ["strong", {}, "bold"],
          " ",
          ["em", {}, "italic"],
          " ",
          ["a", { href: "https://example.com" }, "link"],
        ],
        ["pre", { language: "ts" }, ["code", { class: "language-ts" }, "code"]],
        ["ul", {}, ["li", {}, ["p", {}, ["del", {}, "removed"]]]],
      ]);
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST", async () => {
      const ast = await converter.toAst("Hello world");
      const result = await converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should round-trip bold text", async () => {
      const ast = await converter.toAst("**bold text**");
      const result = await converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should round-trip links", async () => {
      const ast = await converter.toAst("[Link](https://example.com)");
      const result = await converter.fromAst(ast);
      expect(result).toContain("[Link](https://example.com)");
    });
  });

  describe("renderPostable", () => {
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
  });
});
