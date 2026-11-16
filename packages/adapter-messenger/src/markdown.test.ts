import { describe, expect, it } from "vitest";
import { MessengerFormatConverter } from "./markdown";

const converter = new MessengerFormatConverter();

describe("MessengerFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text", async () => {
      const ast = await converter.toAst("Hello world");
      expect(ast.nodes).toEqual([["p", {}, "Hello world"]]);
    });

    it("parses markdown bold", async () => {
      const ast = await converter.toAst("**bold**");
      expect(ast.nodes).toEqual([["p", {}, ["strong", {}, "bold"]]]);
    });

    it("handles empty text", async () => {
      const ast = await converter.toAst("");
      expect(ast.nodes).toEqual([]);
    });
  });

  describe("fromAst", () => {
    it("roundtrips plain text", async () => {
      const text = "Hello world";
      const ast = await converter.toAst(text);
      const result = await converter.fromAst(ast);
      expect(result).toBe(text);
    });

    it("roundtrips markdown formatting", async () => {
      const text = "**bold** and *italic*";
      const ast = await converter.toAst(text);
      const result = await converter.fromAst(ast);
      expect(result).toContain("bold");
      expect(result).toContain("italic");
    });
  });

  describe("renderPostable", () => {
    it("renders string messages", async () => {
      expect(await converter.renderPostable("hello")).toBe("hello");
    });

    it("renders raw messages", async () => {
      expect(await converter.renderPostable({ raw: "raw text" })).toBe(
        "raw text"
      );
    });

    it("renders markdown messages", async () => {
      const result = await converter.renderPostable({ markdown: "**bold**" });
      expect(result).toContain("bold");
    });

    it("renders ast messages", async () => {
      const ast = await converter.toAst("hello from ast");
      const result = await converter.renderPostable({ ast });
      expect(result).toContain("hello from ast");
    });

    it("throws on invalid postable message shapes", async () => {
      await expect(
        converter.renderPostable({ unknown: "value" } as never)
      ).rejects.toThrow();
    });
  });

  describe("extractPlainText", () => {
    it("extracts plain text from markdown", async () => {
      const result = await converter.extractPlainText("**bold** text");
      expect(result).toContain("bold");
      expect(result).toContain("text");
    });
  });
});
