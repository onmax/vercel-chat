import { getNodeTag, parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { XFormatConverter } from "./markdown";

const converter = new XFormatConverter();

describe("XFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text into paragraphs", async () => {
      const ast = await converter.toAst("first block\n\nsecond block");
      expect(ast.nodes.map(getNodeTag)).toEqual(["p", "p"]);
    });

    it("does not treat hashtags as headings", async () => {
      const ast = await converter.toAst("#launch day");
      expect(getNodeTag(ast.nodes[0])).toBe("p");
      expect(await converter.extractPlainText("#launch day")).toBe(
        "#launch day"
      );
    });

    it("does not treat asterisks as emphasis", async () => {
      expect(await converter.extractPlainText("2 * 3 * 4")).toBe("2 * 3 * 4");
    });

    it("promotes URLs to link nodes", async () => {
      const ast = await converter.toAst("see https://chat-sdk.dev for docs");
      expect(ast.nodes).toEqual([
        [
          "p",
          {},
          "see ",
          ["a", { href: "https://chat-sdk.dev" }, "https://chat-sdk.dev"],
          " for docs",
        ],
      ]);
    });

    it("preserves single newlines inside a block", async () => {
      expect(await converter.extractPlainText("line one\nline two")).toBe(
        "line one\nline two"
      );
    });
  });

  describe("fromAst", () => {
    it("strips bold and italic markers", async () => {
      const ast = await parseMarkdown("**bold** and *italic*");
      expect(converter.fromAst(ast)).toBe("bold and italic");
    });

    it("renders links as label (url)", async () => {
      const ast = await parseMarkdown("[docs](https://chat-sdk.dev)");
      expect(converter.fromAst(ast)).toBe("docs (https://chat-sdk.dev)");
    });

    it("renders bare links as the url only", async () => {
      const ast = await parseMarkdown("<https://chat-sdk.dev>");
      expect(converter.fromAst(ast)).toBe("https://chat-sdk.dev");
    });

    it("renders unordered lists with bullets", async () => {
      const ast = await parseMarkdown("- one\n- two");
      expect(converter.fromAst(ast)).toBe("• one\n• two");
    });

    it("renders ordered lists with numbers", async () => {
      const ast = await parseMarkdown("1. one\n2. two");
      expect(converter.fromAst(ast)).toBe("1. one\n2. two");
    });

    it("keeps code block content without fences", async () => {
      const ast = await parseMarkdown("```ts\nconst a = 1;\n```");
      expect(converter.fromAst(ast)).toBe("const a = 1;");
    });

    it("flattens headings to plain text", async () => {
      const ast = await parseMarkdown("# Title");
      expect(converter.fromAst(ast)).toBe("Title");
    });

    it("renders tables as ascii", async () => {
      const ast = await parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
      const output = converter.fromAst(ast);
      expect(output).toContain("a");
      expect(output).toContain("|");
      expect(output).toContain("1");
    });
  });

  describe("renderPostable", () => {
    it("passes strings through untouched", async () => {
      expect(await converter.renderPostable("raw *text*")).toBe("raw *text*");
    });

    it("flattens markdown input", async () => {
      expect(await converter.renderPostable({ markdown: "**hi** there" })).toBe(
        "hi there"
      );
    });
  });
});
