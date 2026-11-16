import { describe, expect, it } from "vitest";
import { InstagramFormatConverter } from "./markdown";

const converter = new InstagramFormatConverter();

describe("InstagramFormatConverter", () => {
  it("round-trips text and markdown through the AST", async () => {
    const ast = await converter.toAst("**Available** today");
    expect(ast.nodes).toEqual([
      ["p", {}, ["strong", {}, "Available"], " today"],
    ]);
    expect(await converter.fromAst(ast)).toBe("Available today");
  });

  it("renders supported postable shapes", async () => {
    expect(await converter.renderPostable("hello")).toBe("hello");
    expect(await converter.renderPostable({ raw: "raw" })).toBe("raw");
    expect(await converter.renderPostable({ markdown: "**bold**" })).toBe(
      "bold"
    );
    expect(
      await converter.renderPostable({ ast: await converter.toAst("from ast") })
    ).toContain("from ast");
  });

  it("extracts plain text", async () => {
    expect(await converter.extractPlainText("**bold** text")).toContain(
      "bold text"
    );
  });
});
