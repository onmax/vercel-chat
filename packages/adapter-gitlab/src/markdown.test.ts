import { emphasis, paragraph, root, strong, text } from "chat";
import { describe, expect, it } from "vitest";
import { GitLabFormatConverter } from "./markdown";

const TEST_BOT_MENTION_WITH_WHITESPACE_REGEX = /@test-bot\s+hi there/;

describe("GitLabFormatConverter", () => {
  const converter = new GitLabFormatConverter();

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

    it("should parse @mentions", async () => {
      const text = await converter.extractPlainText(
        "Hey @username, check this out"
      );
      expect(text).toContain("@username");
    });
  });

  describe("fromAst", () => {
    it("should render plain text", async () => {
      const ast = root([paragraph([text("Hello world")])]);
      const result = await converter.fromAst(ast);
      expect(result).toBe("Hello world");
    });

    it("should render bold text", async () => {
      const ast = root([paragraph([strong([text("bold")])])]);
      const result = await converter.fromAst(ast);
      expect(result).toBe("**bold**");
    });

    it("should render italic text", async () => {
      const ast = root([paragraph([emphasis([text("italic")])])]);
      const result = await converter.fromAst(ast);
      expect(result).toBe("*italic*");
    });
  });

  describe("extractPlainText", () => {
    it("should extract text from markdown", async () => {
      const result = await converter.extractPlainText("**bold** and _italic_");
      expect(result).toBe("bold and italic");
    });

    it("should preserve @mentions", async () => {
      const result = await converter.extractPlainText("Hey @user, **thanks**!");
      expect(result).toContain("@user");
      expect(result).toContain("thanks");
    });

    it("should preserve whitespace after newline-separated @mentions", async () => {
      const result = await converter.extractPlainText("@test-bot\nhi there");
      expect(result).toMatch(TEST_BOT_MENTION_WITH_WHITESPACE_REGEX);
    });

    it("should extract text from code blocks", async () => {
      const result = await converter.extractPlainText("```\ncode\n```");
      expect(result).toContain("code");
    });
  });

  describe("renderPostable", () => {
    it("should render string directly", async () => {
      const result = await converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render raw message", async () => {
      const result = await converter.renderPostable({ raw: "Raw content" });
      expect(result).toBe("Raw content");
    });

    it("should render markdown message", async () => {
      const result = await converter.renderPostable({ markdown: "**bold**" });
      expect(result).toBe("**bold**");
    });

    it("passes GitLab references in markdown through unchanged", async () => {
      const markdown = "Fixes ~bug, see !12 and snake_case";
      expect(await converter.renderPostable({ markdown })).toBe(markdown);
    });

    it("should render ast message", async () => {
      const ast = root([paragraph([text("AST content")])]);
      const result = await converter.renderPostable({ ast });
      expect(result).toBe("AST content");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip simple text", async () => {
      const original = "Hello world";
      const ast = await converter.toAst(original);
      const result = await converter.fromAst(ast);
      expect(result.trim()).toBe(original);
    });

    it("should roundtrip markdown with formatting", async () => {
      const original = "**bold** and *italic*";
      const ast = await converter.toAst(original);
      const result = await converter.fromAst(ast);
      expect(result).toContain("bold");
      expect(result).toContain("italic");
    });
  });
});
