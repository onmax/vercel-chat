/**
 * Tests for markdown parsing, AST building, and format conversion utilities.
 */

import { describe, expect, it, vi } from "vitest";
import {
  Actions,
  Button,
  Card,
  Text as CardText,
  Divider,
  Field,
  Fields,
  Section,
  Table,
} from "./cards";
import {
  BaseFormatConverter,
  blockquote,
  type Content,
  codeBlock,
  DEFAULT_MAX_INCOMING_PARSE_LENGTH,
  emphasis,
  getNodeChildren,
  getNodeTag,
  getNodeValue,
  inlineCode,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListItemNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableCellNode,
  isTableNode,
  isTableRowNode,
  isTextNode,
  type List,
  link,
  markdownToPlainText,
  paragraph,
  parseMarkdown,
  type Root,
  root,
  strikethrough,
  stringifyMarkdown,
  strong,
  type Table as TableNode,
  tableElementToAscii,
  tableToAscii,
  text,
  toPlainText,
  walkAst,
} from "./markdown";
import { TextInput } from "./modals";

const BOT_MENTION_WITH_WHITESPACE_REGEX = /@test-bot\s+hi there/;
const LIST_ITEMS_WITH_WHITESPACE_REGEX = /one\s+two/;

const childTags = (node: Content | undefined): (string | undefined)[] =>
  node === undefined ? [] : getNodeChildren(node).map(getNodeTag);

// ============================================================================
// parseMarkdown Tests
// ============================================================================

describe("parseMarkdown", () => {
  it("parses plain text", async () => {
    const ast = await parseMarkdown("Hello, world!");
    expect(ast.nodes).toHaveLength(1);
    expect(getNodeTag(ast.nodes[0])).toBe("p");
  });

  it("parses bold text", async () => {
    const ast = await parseMarkdown("**bold**");
    expect(childTags(ast.nodes[0])).toEqual(["strong"]);
  });

  it("parses italic text", async () => {
    const ast = await parseMarkdown("_italic_");
    expect(childTags(ast.nodes[0])).toEqual(["em"]);
  });

  it("parses strikethrough (GFM)", async () => {
    const ast = await parseMarkdown("~~deleted~~");
    expect(childTags(ast.nodes[0])).toEqual(["del"]);
  });

  it("parses inline code", async () => {
    const ast = await parseMarkdown("`code`");
    expect(childTags(ast.nodes[0])).toEqual(["code"]);
  });

  it("parses code blocks", async () => {
    const ast = await parseMarkdown("```javascript\nconst x = 1;\n```");
    const codeNode = ast.nodes[0];
    expect(isCodeNode(codeNode)).toBe(true);
    expect(isCodeNode(codeNode) && codeNode[1].language).toBe("javascript");
    expect(getNodeValue(codeNode)).toBe("const x = 1;");
  });

  it("parses links", async () => {
    const ast = await parseMarkdown("[text](https://example.com)");
    const linkNode = getNodeChildren(ast.nodes[0])[0];
    expect(isLinkNode(linkNode)).toBe(true);
    expect(isLinkNode(linkNode) && linkNode[1].href).toBe(
      "https://example.com"
    );
  });

  it("parses blockquotes", async () => {
    const ast = await parseMarkdown("> quoted text");
    expect(getNodeTag(ast.nodes[0])).toBe("blockquote");
  });

  it("parses unordered lists", async () => {
    const ast = await parseMarkdown("- item 1\n- item 2");
    expect(getNodeTag(ast.nodes[0])).toBe("ul");
  });

  it("parses ordered lists", async () => {
    const ast = await parseMarkdown("1. first\n2. second");
    expect(getNodeTag(ast.nodes[0])).toBe("ol");
  });

  it("handles nested formatting", async () => {
    const ast = await parseMarkdown("**_bold italic_**");
    const strongNode = getNodeChildren(ast.nodes[0])[0];
    expect(getNodeTag(strongNode)).toBe("strong");
    expect(childTags(strongNode)).toEqual(["em"]);
  });

  it("handles empty string", async () => {
    const ast = await parseMarkdown("");
    expect(ast.nodes).toHaveLength(0);
  });

  it("handles multiple paragraphs", async () => {
    const ast = await parseMarkdown("First paragraph.\n\nSecond paragraph.");
    expect(ast.nodes.map(getNodeTag)).toEqual(["p", "p"]);
  });

  it("keeps Comark component and attribute syntax as text", async () => {
    const ast = await parseMarkdown("price {cheap} and ::not a component");
    expect(toPlainText(ast)).toBe("price {cheap} and ::not a component");
  });

  it("does not close unterminated markers", async () => {
    const ast = await parseMarkdown("**unclosed");
    expect(ast.nodes).toEqual([["p", {}, "**unclosed"]]);
  });
});

// ============================================================================
// stringifyMarkdown Tests
// ============================================================================

describe("stringifyMarkdown", () => {
  it("stringifies a simple AST", async () => {
    const ast = root([paragraph([text("Hello")])]);
    const result = await stringifyMarkdown(ast);
    expect(result.trim()).toBe("Hello");
  });

  it("stringifies bold text", async () => {
    const ast = root([paragraph([strong([text("bold")])])]);
    const result = await stringifyMarkdown(ast);
    expect(result.trim()).toBe("**bold**");
  });

  it("stringifies italic text", async () => {
    const ast = root([paragraph([emphasis([text("italic")])])]);
    const result = await stringifyMarkdown(ast);
    expect(result.trim()).toBe("*italic*");
  });

  it("stringifies inline code", async () => {
    const ast = root([paragraph([inlineCode("code")])]);
    const result = await stringifyMarkdown(ast);
    expect(result.trim()).toBe("`code`");
  });

  it("stringifies links", async () => {
    const ast = root([
      paragraph([link("https://example.com", [text("link")])]),
    ]);
    const result = await stringifyMarkdown(ast);
    expect(result.trim()).toBe("[link](https://example.com)");
  });

  it("round-trips markdown correctly", async () => {
    const original = "**bold** and _italic_ and `code`";
    const ast = await parseMarkdown(original);
    const result = await stringifyMarkdown(ast);
    // Parse again to normalize
    const reparsed = await parseMarkdown(result);
    expect(reparsed.nodes).toEqual(ast.nodes);
  });
});

// ============================================================================
// toPlainText Tests
// ============================================================================

describe("toPlainText", () => {
  it("extracts plain text from AST", async () => {
    const ast = await parseMarkdown("**bold** and _italic_");
    expect(toPlainText(ast)).toBe("bold and italic");
  });

  it("extracts text from code blocks", async () => {
    const ast = await parseMarkdown("```\ncode block\n```");
    expect(toPlainText(ast)).toBe("code block");
  });

  it("extracts text from links", async () => {
    const ast = await parseMarkdown("[link text](https://example.com)");
    expect(toPlainText(ast)).toBe("link text");
  });

  it("preserves soft line breaks as whitespace", async () => {
    const ast = await parseMarkdown("@test-bot\nhi there");
    expect(toPlainText(ast)).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });

  it("preserves paragraph boundaries as whitespace", async () => {
    const ast = await parseMarkdown("@test-bot\n\nhi there");
    expect(toPlainText(ast)).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });

  it("separates list items with whitespace", async () => {
    const ast = await parseMarkdown("- one\n- two");
    expect(toPlainText(ast)).toMatch(LIST_ITEMS_WITH_WHITESPACE_REGEX);
  });

  it("separates table cells and rows with structural whitespace", async () => {
    const ast = await parseMarkdown(
      "| Name | Role |\n| --- | --- |\n| **Ada** Lovelace | Engineer |"
    );
    expect(toPlainText(ast)).toBe("Name\tRole\nAda Lovelace\tEngineer");
  });

  it("keeps empty table cells so columns stay aligned", async () => {
    const ast = await parseMarkdown(
      "| Name | Middle | Units |\n| --- | --- | --- |\n| Samsung |  | 3 |"
    );
    expect(toPlainText(ast)).toBe("Name\tMiddle\tUnits\nSamsung\t\t3");
  });

  it("drops table rows with no content", async () => {
    const ast = await parseMarkdown("|  |  |\n| --- | --- |\n| Samsung | 3 |");
    expect(toPlainText(ast)).toBe("Samsung\t3");
  });

  it("handles empty AST", () => {
    expect(toPlainText(root([]))).toBe("");
  });
});

// ============================================================================
// markdownToPlainText Tests
// ============================================================================

describe("markdownToPlainText", () => {
  it("converts markdown to plain text directly", async () => {
    const result = await markdownToPlainText("**bold** and _italic_");
    expect(result).toBe("bold and italic");
  });

  it("handles complex markdown", async () => {
    const result = await markdownToPlainText(
      "# Heading\n\nParagraph with `code`."
    );
    expect(result).toContain("Heading");
    expect(result).toContain("Paragraph with code");
  });

  it("preserves whitespace after a newline-separated mention", async () => {
    const result = await markdownToPlainText("@test-bot\nhi there");
    expect(result).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });

  it("preserves whitespace after a paragraph-separated mention", async () => {
    const result = await markdownToPlainText("@test-bot\n\nhi there");
    expect(result).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });
});

// ============================================================================
// walkAst Tests
// ============================================================================

describe("walkAst", () => {
  const nodeKind = (node: Content) => getNodeTag(node) ?? "text";

  it("visits all nodes", async () => {
    const ast = await parseMarkdown("**bold** and _italic_");
    const visited: string[] = [];

    walkAst(ast, (node) => {
      visited.push(nodeKind(node));
      return node;
    });

    expect(visited).toContain("p");
    expect(visited).toContain("strong");
    expect(visited).toContain("em");
    expect(visited).toContain("text");
  });

  it("allows filtering nodes by returning null", async () => {
    const ast = await parseMarkdown("**bold** and _italic_");

    const filtered = walkAst(ast, (node) => {
      // Remove all strong nodes
      if (isStrongNode(node)) {
        return null;
      }
      return node;
    });

    const plainText = toPlainText(filtered);
    expect(plainText).not.toContain("bold");
    expect(plainText).toContain("italic");
  });

  it("allows transforming nodes", () => {
    const ast = root([paragraph([text("hello")])]);

    const transformed = walkAst(ast, (node) =>
      isTextNode(node) ? node.toUpperCase() : node
    );

    expect(toPlainText(transformed)).toBe("HELLO");
  });

  it("handles deeply nested structures", async () => {
    const ast = await parseMarkdown("> **_nested_ text**");
    const types: string[] = [];

    walkAst(ast, (node) => {
      types.push(nodeKind(node));
      return node;
    });

    expect(types).toContain("blockquote");
    expect(types).toContain("strong");
    expect(types).toContain("em");
  });

  it("handles empty AST", () => {
    const visited: string[] = [];

    walkAst(root([]), (node) => {
      visited.push(nodeKind(node));
      return node;
    });

    expect(visited).toHaveLength(0);
  });
});

// ============================================================================
// AST Builder Functions Tests
// ============================================================================

describe("AST builder functions", () => {
  describe("text", () => {
    it("creates a text node", () => {
      expect(text("hello")).toBe("hello");
    });

    it("handles empty string", () => {
      expect(text("")).toBe("");
    });

    it("handles special characters", () => {
      expect(text('hello & world < > "')).toBe('hello & world < > "');
    });
  });

  describe("strong", () => {
    it("creates a strong node", () => {
      expect(strong([text("bold")])).toEqual(["strong", {}, "bold"]);
    });

    it("handles nested content", () => {
      const node = strong([emphasis([text("bold italic")])]);
      expect(childTags(node)).toEqual(["em"]);
    });
  });

  describe("emphasis", () => {
    it("creates an emphasis node", () => {
      expect(emphasis([text("italic")])).toEqual(["em", {}, "italic"]);
    });
  });

  describe("strikethrough", () => {
    it("creates a delete node", () => {
      expect(strikethrough([text("deleted")])).toEqual(["del", {}, "deleted"]);
    });
  });

  describe("inlineCode", () => {
    it("creates an inline code node", () => {
      const node = inlineCode("const x = 1");
      expect(node).toEqual(["code", {}, "const x = 1"]);
      expect(getNodeValue(node)).toBe("const x = 1");
    });
  });

  describe("codeBlock", () => {
    it("creates a code block node", () => {
      const node = codeBlock("function() {}", "javascript");
      expect(isCodeNode(node)).toBe(true);
      expect(getNodeValue(node)).toBe("function() {}");
      expect(node[1].language).toBe("javascript");
    });

    it("handles missing language", () => {
      expect(codeBlock("plain code")[1].language).toBeUndefined();
    });

    it("matches the parser's output", async () => {
      const ast = await parseMarkdown("```ts\nconst a = 1\n```");
      expect(ast.nodes[0]).toEqual(codeBlock("const a = 1", "ts"));
    });
  });

  describe("link", () => {
    it("creates a link node", () => {
      const node = link("https://example.com", [text("Example")]);
      expect(node).toEqual(["a", { href: "https://example.com" }, "Example"]);
    });

    it("handles title", () => {
      const node = link("https://example.com", [text("Example")], "Title");
      expect(node[1].title).toBe("Title");
    });
  });

  describe("blockquote", () => {
    it("creates a blockquote node", () => {
      const node = blockquote([paragraph([text("quoted")])]);
      expect(getNodeTag(node)).toBe("blockquote");
      expect(getNodeChildren(node)).toHaveLength(1);
    });
  });

  describe("paragraph", () => {
    it("creates a paragraph node", () => {
      expect(paragraph([text("content")])).toEqual(["p", {}, "content"]);
    });
  });

  describe("root", () => {
    it("creates a root node", () => {
      const node = root([paragraph([text("content")])]);
      expect(node).toEqual({
        nodes: [["p", {}, "content"]],
        frontmatter: {},
        meta: {},
      });
    });

    it("handles empty children", () => {
      expect(root([]).nodes).toHaveLength(0);
    });
  });
});

// ============================================================================
// BaseFormatConverter Tests
// ============================================================================

describe("BaseFormatConverter", () => {
  // Create a simple test implementation
  class TestConverter extends BaseFormatConverter {
    fromAst(ast: Root): string {
      return toPlainText(ast);
    }

    toAst(text: string): Promise<Root> {
      return parseMarkdown(text);
    }
  }

  const converter = new TestConverter();

  describe("extractPlainText", () => {
    it("extracts plain text from platform format", async () => {
      const result = await converter.extractPlainText("**bold** text");
      expect(result).toBe("bold text");
    });
  });

  describe("parseIncoming", { timeout: 20_000 }, () => {
    const unparsed = (input: string) => ({
      text: input,
      formatted: root([paragraph([text(input)])]),
    });

    const parsed = async (input: string) => {
      const formatted = await parseMarkdown(input);
      return { text: toPlainText(formatted), formatted };
    };

    // Recursive, so only call it on shallow trees.
    const nodeDepth = (node: Content): number => {
      const children = getNodeChildren(node);
      return children.length === 0
        ? 0
        : 1 + Math.max(...children.map(nodeDepth));
    };
    const maxDepth = (ast: Root): number =>
      ast.nodes.length === 0 ? 0 : 1 + Math.max(...ast.nodes.map(nodeDepth));

    const countNodes = (node: Content, tag: string): number =>
      (getNodeTag(node) === tag ? 1 : 0) +
      getNodeChildren(node).reduce(
        (sum, child) => sum + countNodes(child, tag),
        0
      );

    const parseWithSpy = async (
      input: string,
      parsing: BaseFormatConverter = new TestConverter()
    ) => {
      const toAst = vi.spyOn(parsing, "toAst");
      const result = await parsing.parseIncoming(input);
      return { result, toAstCalls: toAst.mock.calls.length };
    };
    const parsedOnce = async (input: string) => ({
      result: await parsed(input),
      toAstCalls: 1,
    });

    // Emphasis nested inline, so its depth is levels + 2. The parser doesn't
    // cap inline nesting.
    const nestedEmphasis = (levels: number): string =>
      `${"*a ".repeat(levels)}${"a* ".repeat(levels)}`;

    // Lists nested by indentation, one marker per line.
    const staircase = (levels: number): string =>
      Array.from({ length: levels }, (_, i) => `${"  ".repeat(i)}- a`).join(
        "\n"
      );

    // Lifts the length and depth limits so input reaches the parser.
    class UnlimitedConverter extends TestConverter {
      protected override maxIncomingParseLength = 1_000_000;
      protected override maxIncomingAstDepth = 100_000;
    }

    it("matches extractPlainText and toAst for markdown input", async () => {
      const input =
        "# Title\n\n**bold** and _italic_ with `code`\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |";
      const result = await converter.parseIncoming(input);
      expect(result.text).toBe(
        "Title\n\nbold and italic with code\n\none\ntwo\n\na\tb\n1\t2"
      );
      expect(result.text).toBe(await converter.extractPlainText(input));
      expect(result).toEqual(await parsed(input));
      expect(result).not.toEqual(unparsed(input));
    });

    it("parses input once", async () => {
      const parsing = new TestConverter();
      const toAst = vi.spyOn(parsing, "toAst");
      const result = await parsing.parseIncoming("**bold** text");
      expect(result.text).toBe("bold text");
      expect(result.formatted).toMatchObject(
        root([paragraph([strong([text("bold")]), text(" text")])])
      );
      expect(result).toEqual(await parsed("**bold** text"));
      expect(result).not.toEqual(unparsed("**bold** text"));
      expect(toAst).toHaveBeenCalledTimes(1);
    });

    describe("length limit", () => {
      it("defaults to 16,384 characters", () => {
        expect(DEFAULT_MAX_INCOMING_PARSE_LENGTH).toBe(16_384);
      });

      it("parses input at the limit", async () => {
        const parsing = new TestConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH - 8)}`;
        const result = await parsing.parseIncoming(input);
        expect(result.text).toBe(
          `bold${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH - 8)}`
        );
        expect(result).toEqual(await parsed(input));
        expect(result).not.toEqual(unparsed(input));
        expect(toAst).toHaveBeenCalledTimes(1);
      });

      it("keeps input over the limit as a single text node", async () => {
        const parsing = new TestConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH - 7)}`;
        const result = await parsing.parseIncoming(input);
        expect(result).toEqual({
          text: input,
          formatted: { nodes: [["p", {}, input]], frontmatter: {}, meta: {} },
        });
        expect(toAst).not.toHaveBeenCalled();
      });

      it("respects a lower subclass limit", async () => {
        class SmallLimitConverter extends TestConverter {
          protected override maxIncomingParseLength = 5;
        }
        const parsing = new SmallLimitConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const result = await parsing.parseIncoming("**bold**");
        expect(result).toEqual(unparsed("**bold**"));
        expect(toAst).not.toHaveBeenCalled();
      });

      it("respects a higher subclass limit", async () => {
        class LargeLimitConverter extends TestConverter {
          protected override maxIncomingParseLength = 20_000;
        }
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH)}`;
        const result = await new LargeLimitConverter().parseIncoming(input);
        expect(result).toEqual(await parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("stack overflow while parsing", () => {
      it("keeps input that overflows the parser as a single text node", async () => {
        const parsing = new UnlimitedConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = nestedEmphasis(3000);
        await expect(parseMarkdown(input)).rejects.toThrow(RangeError);
        expect(await parsing.parseIncoming(input)).toEqual(unparsed(input));
        expect(toAst).toHaveBeenCalledTimes(1);
      });

      it("keeps 6,000 nested blockquote markers as a single text node", async () => {
        const input = ">".repeat(6000);
        expect(await converter.parseIncoming(input)).toEqual(unparsed(input));
      });

      it("falls back when toAst throws a RangeError", async () => {
        class OverflowConverter extends TestConverter {
          override toAst(): Promise<Root> {
            throw new RangeError("Maximum call stack size exceeded");
          }
        }
        expect(await new OverflowConverter().parseIncoming("**bold**")).toEqual(
          unparsed("**bold**")
        );
      });

      it("falls back when toAst rejects with a RangeError", async () => {
        class OverflowConverter extends TestConverter {
          override toAst(): Promise<Root> {
            return Promise.reject(
              new RangeError("Maximum call stack size exceeded")
            );
          }
        }
        expect(await new OverflowConverter().parseIncoming("**bold**")).toEqual(
          unparsed("**bold**")
        );
      });

      it("propagates other errors from toAst", async () => {
        class BrokenConverter extends TestConverter {
          override toAst(): Promise<Root> {
            throw new TypeError("broken parser");
          }
        }
        await expect(
          new BrokenConverter().parseIncoming("**bold**")
        ).rejects.toThrow(new TypeError("broken parser"));
      });
    });

    describe("AST depth limit", () => {
      it.each([
        ["blockquotes", (n: number) => `${">".repeat(n)}a`, 97, 99, 98, 100],
        ["lists", (n: number) => `${"- ".repeat(n)}a`, 48, 98, 49, 100],
        ["lists nested by indentation", staircase, 48, 98, 49, 100],
        ["nested emphasis", nestedEmphasis, 97, 99, 98, 100],
      ])("parses %s below depth 100 and rejects them at it", async (_name, build, atLevels, atDepth, overLevels, overDepth) => {
        const atLimit = build(atLevels);
        expect(maxDepth(await parseMarkdown(atLimit))).toBe(atDepth);
        const result = await parseWithSpy(atLimit);
        expect(result).toEqual(await parsedOnce(atLimit));
        expect(result.result).not.toEqual(unparsed(atLimit));

        const overLimit = build(overLevels);
        expect(maxDepth(await parseMarkdown(overLimit))).toBe(overDepth);
        expect(await parseWithSpy(overLimit)).toEqual({
          result: unparsed(overLimit),
          toAstCalls: 1,
        });
      });

      it("keeps input the parser cuts short at 100 levels as text", async () => {
        // The parser drops everything after nesting that reaches 100
        // levels, including later paragraphs.
        const input = `first\n\n${"- ".repeat(51)}deep\n\nlast`;
        expect(toPlainText(await parseMarkdown(input))).toBe("first");
        expect(await converter.parseIncoming(input)).toEqual(unparsed(input));
      });

      it("keeps input with thousands of nested markers as a single text node", async () => {
        const input = ">".repeat(3000);
        expect(await converter.parseIncoming(input)).toEqual(unparsed(input));
      });

      it("respects a lower subclass limit", async () => {
        class ShallowConverter extends TestConverter {
          protected override maxIncomingAstDepth = 3;
        }
        expect(maxDepth(await parseMarkdown("> a"))).toBe(3);
        const result = await new ShallowConverter().parseIncoming("> a");
        expect(result).toEqual(await parsed("> a"));
        expect(result).not.toEqual(unparsed("> a"));
        expect(await parseWithSpy(">> a", new ShallowConverter())).toEqual({
          result: unparsed(">> a"),
          toAstCalls: 1,
        });
      });

      it("respects a higher subclass limit", async () => {
        class DeepConverter extends TestConverter {
          protected override maxIncomingAstDepth = 1000;
        }
        const input = nestedEmphasis(200);
        expect(maxDepth(await parseMarkdown(input))).toBe(202);
        expect(await converter.parseIncoming(input)).toEqual(unparsed(input));
        const result = await new DeepConverter().parseIncoming(input);
        expect(result).toEqual(await parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("subclass hooks", () => {
      class PrefixedFallbackConverter extends TestConverter {
        readonly fallbackCalls: string[] = [];

        protected override incomingFallbackText(platformText: string): string {
          this.fallbackCalls.push(platformText);
          return `unparsed: ${platformText}`;
        }
      }

      class UnlimitedPrefixedFallbackConverter extends PrefixedFallbackConverter {
        protected override maxIncomingParseLength = 1_000_000;
        protected override maxIncomingAstDepth = 100_000;
      }

      it.each([
        [
          "length",
          `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH)}`,
          PrefixedFallbackConverter,
          0,
        ],
        [
          "stack overflow",
          nestedEmphasis(3000),
          UnlimitedPrefixedFallbackConverter,
          1,
        ],
        ["AST depth", nestedEmphasis(98), PrefixedFallbackConverter, 1],
      ])("uses incomingFallbackText for the %s fallback", async (_name, input, Converter, toAstCalls) => {
        const parsing = new Converter();
        const toAst = vi.spyOn(parsing, "toAst");
        const expected = `unparsed: ${input}`;
        expect(await parsing.parseIncoming(input)).toEqual({
          text: expected,
          formatted: root([paragraph([text(expected)])]),
        });
        expect(parsing.fallbackCalls).toEqual([input]);
        expect(toAst).toHaveBeenCalledTimes(toAstCalls);
      });

      it("does not call incomingFallbackText when parsing succeeds", async () => {
        const parsing = new PrefixedFallbackConverter();
        const result = await parsing.parseIncoming("**bold** text");
        expect(result).toEqual(await parsed("**bold** text"));
        expect(parsing.fallbackCalls).toEqual([]);
      });

      it("falls back without parsing when exceedsIncomingBudget returns true", async () => {
        class NoBudgetConverter extends TestConverter {
          protected override exceedsIncomingBudget(): boolean {
            return true;
          }
        }
        const parsing = new NoBudgetConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        expect(await parsing.parseIncoming("**bold**")).toEqual(
          unparsed("**bold**")
        );
        expect(toAst).not.toHaveBeenCalled();
      });

      it("parses over-budget input when exceedsIncomingBudget returns false", async () => {
        class NoLimitConverter extends TestConverter {
          protected override exceedsIncomingBudget(): boolean {
            return false;
          }
        }
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH)}`;
        const result = await new NoLimitConverter().parseIncoming(input);
        expect(result).toEqual(await parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("adversarial input", () => {
      const pipeTable = `| a | b |\n| - | - |\n${"| 1 | 2 |\n".repeat(1636)}`;

      it.each([
        ["unmatched *", "*a".repeat(8192)],
        ["unmatched ~", "~a".repeat(8192)],
        ["unmatched ]", "[a".repeat(4096) + "]".repeat(4096)],
        ["unclosed <", "<a ".repeat(5000)],
        ["6,000 nested >", ">".repeat(6000)],
        ["3,000 nested >", ">".repeat(3000)],
        ["16K pipe table", pipeTable],
      ])("returns a serializable AST for %s", async (_name, input) => {
        const result = await converter.parseIncoming(input);
        expect(() => JSON.stringify(result.formatted)).not.toThrow();
        await expect(stringifyMarkdown(result.formatted)).resolves.toEqual(
          expect.any(String)
        );
      });

      it("parses a 16K pipe table", async () => {
        expect(pipeTable.length).toBeLessThanOrEqual(
          DEFAULT_MAX_INCOMING_PARSE_LENGTH
        );
        const result = await converter.parseIncoming(pipeTable);
        expect(result).toEqual(await parsed(pipeTable));
        expect(result).not.toEqual(unparsed(pipeTable));
        expect(
          result.formatted.nodes.reduce(
            (sum, node) => sum + countNodes(node, "tr"),
            0
          )
        ).toBe(1637);
      });
    });
  });

  describe("fromMarkdown", () => {
    it("converts markdown to platform format", async () => {
      expect(await converter.fromMarkdown("**bold**")).toBe("bold");
    });
  });

  describe("toMarkdown", () => {
    it("converts platform format to markdown", async () => {
      const result = await converter.toMarkdown("plain text");
      expect(result.trim()).toBe("plain text");
    });
  });

  describe("renderPostable", () => {
    it("handles string input", async () => {
      expect(await converter.renderPostable("plain string")).toBe(
        "plain string"
      );
    });

    it("handles raw message", async () => {
      expect(await converter.renderPostable({ raw: "raw text" })).toBe(
        "raw text"
      );
    });

    it("handles markdown message", async () => {
      expect(await converter.renderPostable({ markdown: "**bold**" })).toBe(
        "bold"
      );
    });

    it("handles AST message", async () => {
      const ast = root([paragraph([text("from ast")])]);
      expect(await converter.renderPostable({ ast })).toBe("from ast");
    });

    it("handles card with fallback text", async () => {
      const card = Card({ title: "Title", children: [CardText("Content")] });
      const result = await converter.renderPostable({
        card,
        fallbackText: "Custom fallback",
      });
      expect(result).toBe("Custom fallback");
    });

    it("generates fallback text from card", async () => {
      const card = Card({
        title: "Order Status",
        subtitle: "Your order details",
        children: [CardText("Processing your order...")],
      });
      const result = await converter.renderPostable({ card });
      expect(result).toContain("Order Status");
      expect(result).toContain("Your order details");
      expect(result).toContain("Processing your order...");
    });

    it("handles card with actions", async () => {
      const card = Card({
        title: "Confirm",
        children: [
          Actions([
            Button({ id: "yes", label: "Yes" }),
            Button({ id: "no", label: "No" }),
          ]),
        ],
      });
      const result = await converter.renderPostable({ card });
      expect(result).toContain("Confirm");
      // Actions excluded from fallback — interactive elements aren't meaningful in notifications
      expect(result).not.toContain("[Yes]");
      expect(result).not.toContain("[No]");
    });

    it("handles card with fields", async () => {
      const card = Card({
        children: [
          Fields([
            Field({ label: "Name", value: "John" }),
            Field({ label: "Email", value: "john@example.com" }),
          ]),
        ],
      });
      const result = await converter.renderPostable({ card });
      expect(result).toContain("**Name**: John");
      expect(result).toContain("**Email**: john@example.com");
    });

    it("handles direct CardElement", async () => {
      const card = Card({ title: "Direct Card" });
      expect(await converter.renderPostable(card)).toContain("Direct Card");
    });

    it("throws on invalid input", async () => {
      await expect(
        // @ts-expect-error Testing invalid input
        converter.renderPostable({ invalid: true })
      ).rejects.toThrow();
    });

    it("handles card with table element", async () => {
      const card = Card({
        children: [
          Table({
            headers: ["Name", "Age"],
            rows: [
              ["Alice", "30"],
              ["Bob", "25"],
            ],
          }),
        ],
      });
      const result = await converter.renderPostable({ card });
      expect(result).toContain("Name");
      expect(result).toContain("Age");
      expect(result).toContain("Alice");
      expect(result).toContain("30");
    });
  });

  describe("deprecated toPlainText method", () => {
    it("extracts plain text from platform format", async () => {
      expect(await converter.toPlainText("**bold** text")).toBe("bold text");
    });
  });

  describe("renderList", () => {
    class ListTestConverter extends BaseFormatConverter {
      constructor(indentContinuationLines = false) {
        super();
        this.indentListContinuationLines = indentContinuationLines;
      }

      fromAst(ast: Root): string {
        return this.fromAstWithNodeConverter(ast, (node) =>
          this.nodeToText(node)
        );
      }

      toAst(inputText: string): Promise<Root> {
        return parseMarkdown(inputText);
      }

      private nodeToText(node: Content): string {
        if (isListNode(node)) {
          return this.renderList(node, 0, (child) => this.nodeToText(child));
        }
        if (isCodeNode(node)) {
          return `\`\`\`\n${getNodeValue(node)}\n\`\`\``;
        }
        return toPlainText(root([node]));
      }
    }

    const listConverter = new ListTestConverter();
    const commonMarkConverter = new ListTestConverter(true);

    const firstItemChildTags = async (markdown: string) => {
      const list = (await parseMarkdown(markdown)).nodes[0] as List;
      return childTags(getNodeChildren(list)[0]);
    };

    it("indents nested lists to the parent's content column", async () => {
      const markdown = "1. parent\n   1. child\n2. next";
      expect(await listConverter.fromMarkdown(markdown)).toBe(markdown);
    });

    it("puts a nested list that is an item's first child on the marker line", async () => {
      const markdown = "- - a\n  - b\n- c";
      expect(await listConverter.fromMarkdown(markdown)).toBe(markdown);
    });

    it("indents nested lists under multi-digit markers", async () => {
      const result = await listConverter.fromMarkdown(
        "10. parent\n    - child"
      );
      expect(result).toBe("10. parent\n    - child");
    });

    it("separates paragraphs inside one item with a blank line", async () => {
      const markdown = "- first\n\n  second\n- next";
      expect(await listConverter.fromMarkdown(markdown)).toBe(markdown);
    });

    it("separates a nested ordered list that doesn't start at 1", async () => {
      const result = await listConverter.fromMarkdown(
        "1. parent\n\n   3. child\n2. next"
      );
      expect(result).toBe("1. parent\n\n   3. child\n2. next");
      expect(await firstItemChildTags(result)).toEqual(["p", "ol"]);
    });

    it("leaves later lines of a multi-line block unindented by default", async () => {
      const result = await listConverter.fromMarkdown(
        "- item\n\n  ```\n  x\n  ```"
      );
      expect(result).toBe("- item\n\n  ```\nx\n```");
    });

    it("leaves later lines unindented in nested items by default", async () => {
      const result = await listConverter.fromMarkdown(
        "- parent\n  - item\n\n    ```\n    x\n\n    y\n    ```"
      );
      expect(result).toBe("- parent\n  - item\n\n    ```\nx\n\ny\n```");
    });

    it("indents every line of a multi-line block when enabled", async () => {
      const markdown = "- item\n\n  ```\n  x\n\n  y\n  ```\n- next";
      expect(await commonMarkConverter.fromMarkdown(markdown)).toBe(markdown);
    });

    it("treats a carriage return as a line break when indenting", () => {
      const ast = root([
        ["ul", {}, ["li", {}, paragraph([text("item")]), codeBlock("x\ry")]],
      ]);
      expect(commonMarkConverter.fromAst(ast)).toBe(
        "- item\n\n  ```\n  x\n  y\n  ```"
      );
    });

    it("round-trips its output through the Markdown parser when enabled", async () => {
      const markdown =
        "1. parent\n\n   more\n\n   ```\n   code\n   ```\n   - child\n2. next";
      const once = await commonMarkConverter.fromMarkdown(markdown);
      expect(once).toBe(markdown);
      const list = (await parseMarkdown(once)).nodes[0] as List;
      expect(getNodeChildren(list)).toHaveLength(2);
      expect(childTags(getNodeChildren(list)[0])).toEqual([
        "p",
        "p",
        "pre",
        "ul",
      ]);
    });
  });

  describe("fromAstWithNodeConverter", () => {
    class NodeConverterTestConverter extends BaseFormatConverter {
      fromAst(ast: Root): string {
        return this.fromAstWithNodeConverter(ast, (node) => {
          if (isParagraphNode(node)) {
            return `[para:${toPlainText(root([node]))}]`;
          }
          return toPlainText(root([node]));
        });
      }

      toAst(inputText: string): Promise<Root> {
        return parseMarkdown(inputText);
      }
    }

    const nodeConverter = new NodeConverterTestConverter();

    it("joins multiple paragraphs with double newlines", () => {
      const ast = root([
        paragraph([text("First")]),
        paragraph([text("Second")]),
      ]);
      expect(nodeConverter.fromAst(ast)).toBe("[para:First]\n\n[para:Second]");
    });

    it("handles single paragraph", () => {
      const ast = root([paragraph([text("Only")])]);
      expect(nodeConverter.fromAst(ast)).toBe("[para:Only]");
    });

    it("handles empty AST", () => {
      expect(nodeConverter.fromAst(root([]))).toBe("");
    });
  });

  describe("cardToFallbackText via renderPostable", () => {
    it("handles card with section children", async () => {
      const card = Card({
        children: [
          Section([CardText("Section content"), CardText("More content")]),
        ],
      });
      const result = await converter.renderPostable({ card });
      expect(result).toContain("Section content");
      expect(result).toContain("More content");
    });

    it("handles card with only title (no children)", async () => {
      const card = Card({ title: "Title Only" });
      expect(await converter.renderPostable({ card })).toBe("**Title Only**");
    });

    it("handles card with divider child (returns null for divider)", async () => {
      const card = Card({
        title: "With Divider",
        children: [Divider()],
      });
      // Divider falls to default case and returns null, so only title
      expect(await converter.renderPostable({ card })).toBe("**With Divider**");
    });

    it("falls back to a text input's label", async () => {
      // Adapters that inherit this converter (github, instagram, linear,
      // messenger, web) have no card-input rendering, so the label is the only
      // thing that tells the reader what the card was asking for.
      const card = Card({
        title: "Deploy?",
        children: [TextInput({ id: "notes", label: "Notes" })],
      });
      expect(await converter.renderPostable({ card })).toBe(
        "**Deploy?**\nNotes"
      );
    });

    it("handles card with mixed children including actions (excluded)", async () => {
      const card = Card({
        title: "Mixed",
        children: [
          CardText("Visible text"),
          Actions([Button({ id: "ok", label: "OK" })]),
          Fields([Field({ label: "Key", value: "Val" })]),
        ],
      });
      const result = await converter.renderPostable({ card });
      expect(result).toContain("Visible text");
      expect(result).not.toContain("OK");
      expect(result).toContain("**Key**: Val");
    });
  });

  describe("fromAstWithNodeConverter", () => {
    it("joins multiple paragraphs with double newlines", () => {
      const ast = root([
        paragraph([text("First")]),
        paragraph([text("Second")]),
        paragraph([text("Third")]),
      ]);
      const result = converter.fromAst(ast);
      // TestConverter uses toPlainText which concatenates
      expect(result).toContain("First");
      expect(result).toContain("Second");
      expect(result).toContain("Third");
    });
  });
});

// ============================================================================
// Table Parsing and Rendering Tests
// ============================================================================

describe("parseMarkdown (tables)", () => {
  it("parses GFM tables", async () => {
    const ast = await parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(getNodeTag(ast.nodes[0])).toBe("table");
  });

  it("parses table with multiple rows", async () => {
    const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
    const table = (await parseMarkdown(md)).nodes[0];
    expect(childTags(table)).toEqual(["thead", "tbody"]);
    const [head, body] = getNodeChildren(table);
    expect(getNodeChildren(head)).toHaveLength(1);
    expect(getNodeChildren(body)).toHaveLength(2);
  });
});

describe("table type guards", () => {
  const firstRow = async () => {
    const ast = await parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    return getNodeChildren(getNodeChildren(ast.nodes[0])[0])[0];
  };

  it("isTableNode identifies table nodes", async () => {
    const ast = await parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(isTableNode(ast.nodes[0])).toBe(true);
    expect(isTableNode(paragraph([]))).toBe(false);
  });

  it("isTableRowNode identifies table row nodes", async () => {
    expect(isTableRowNode(await firstRow())).toBe(true);
  });

  it("isTableCellNode identifies table cell nodes", async () => {
    const cell = getNodeChildren(await firstRow())[0];
    expect(isTableCellNode(cell)).toBe(true);
  });
});

describe("tableToAscii", () => {
  it("renders a simple table", async () => {
    const ast = await parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    const result = tableToAscii(ast.nodes[0] as TableNode);
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("1");
    expect(result).toContain("2");
    // Separator line with dashes
    expect(result).toContain("-|");
  });

  it("pads columns to equal width", async () => {
    const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
    const ast = await parseMarkdown(md);
    const lines = tableToAscii(ast.nodes[0] as TableNode).split("\n");
    // Header
    expect(lines[0]).toBe("Name  | Age");
    // Separator
    expect(lines[1]).toBe("------|----");
    // Data rows
    expect(lines[2]).toBe("Alice | 30");
    expect(lines[3]).toBe("Bob   | 25");
  });

  it("handles empty table", () => {
    expect(tableToAscii(["table", {}])).toBe("");
  });
});

describe("tableElementToAscii", () => {
  it("renders headers and rows", () => {
    const result = tableElementToAscii(
      ["Name", "Age"],
      [
        ["Alice", "30"],
        ["Bob", "25"],
      ]
    );
    const lines = result.split("\n");
    expect(lines).toHaveLength(4); // header + separator + 2 data rows
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Age");
    expect(lines[1]).toContain("---");
    expect(lines[2]).toContain("Alice");
    expect(lines[3]).toContain("Bob");
  });

  it("pads columns correctly", () => {
    const result = tableElementToAscii(
      ["Name", "Age", "Role"],
      [
        ["Alice", "30", "Engineer"],
        ["Bob", "25", "Designer"],
      ]
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("Name  | Age | Role");
    expect(lines[2]).toBe("Alice | 30  | Engineer");
    expect(lines[3]).toBe("Bob   | 25  | Designer");
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("Type guards", () => {
  it.each([
    ["isTextNode", isTextNode, text("hello"), paragraph([])],
    ["isParagraphNode", isParagraphNode, paragraph([]), text("hello")],
    [
      "isStrongNode",
      isStrongNode,
      strong([text("bold")]),
      emphasis([text("italic")]),
    ],
    ["isEmphasisNode", isEmphasisNode, emphasis([text("italic")]), "hello"],
    ["isDeleteNode", isDeleteNode, strikethrough([text("deleted")]), "hello"],
    [
      "isInlineCodeNode",
      isInlineCodeNode,
      inlineCode("code"),
      codeBlock("block code"),
    ],
    ["isCodeNode", isCodeNode, codeBlock("const x = 1"), inlineCode("code")],
    [
      "isLinkNode",
      isLinkNode,
      link("https://example.com", [text("link")]),
      "hello",
    ],
    [
      "isBlockquoteNode",
      isBlockquoteNode,
      blockquote([paragraph([text("quoted")])]),
      "hello",
    ],
  ] as const)("%s tells matching nodes from others", (_name, guard, match, other) => {
    expect(guard(match)).toBe(true);
    expect(guard(other)).toBe(false);
  });

  describe("isListNode", () => {
    it("returns true for list nodes", async () => {
      expect(
        isListNode((await parseMarkdown("- item 1\n- item 2")).nodes[0])
      ).toBe(true);
      expect(isListNode((await parseMarkdown("1. item")).nodes[0])).toBe(true);
    });

    it("returns false for non-list nodes", () => {
      expect(isListNode(text("hello"))).toBe(false);
    });
  });

  describe("isListItemNode", () => {
    it("returns true for list item nodes", async () => {
      const list = (await parseMarkdown("- item 1")).nodes[0];
      expect(isListItemNode(getNodeChildren(list)[0])).toBe(true);
    });

    it("returns false for non-list-item nodes", () => {
      expect(isListItemNode(text("hello"))).toBe(false);
    });
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("getNodeChildren", () => {
  it("returns children for paragraph node", () => {
    const children = getNodeChildren(
      paragraph([text("hello"), text(" world")])
    );
    expect(children).toEqual(["hello", " world"]);
  });

  it("returns children for strong node", () => {
    expect(getNodeChildren(strong([text("bold")]))).toHaveLength(1);
  });

  it("returns empty array for text node (no children)", () => {
    expect(getNodeChildren(text("hello"))).toEqual([]);
  });

  it("returns the code text for inline code node", () => {
    expect(getNodeChildren(inlineCode("code"))).toEqual(["code"]);
  });

  it("returns the inner code element for code block node", () => {
    expect(childTags(codeBlock("code", "js"))).toEqual(["code"]);
  });

  it("returns children for blockquote node", () => {
    const node = blockquote([paragraph([text("quoted")])]);
    expect(childTags(node)).toEqual(["p"]);
  });

  it("returns children for emphasis node", () => {
    expect(getNodeChildren(emphasis([text("italic")]))).toHaveLength(1);
  });

  it("returns children for link node", () => {
    const node = link("https://example.com", [text("link")]);
    expect(getNodeChildren(node)).toHaveLength(1);
  });
});

describe("getNodeValue", () => {
  it("returns value for text node", () => {
    expect(getNodeValue(text("hello"))).toBe("hello");
  });

  it("returns value for inline code node", () => {
    expect(getNodeValue(inlineCode("const x = 1"))).toBe("const x = 1");
  });

  it("returns value for code block node", () => {
    expect(getNodeValue(codeBlock("function() {}"))).toBe("function() {}");
  });

  it.each([
    ["paragraph", paragraph([text("hello")])],
    ["strong", strong([text("bold")])],
    ["emphasis", emphasis([text("italic")])],
    ["blockquote", blockquote([paragraph([text("quoted")])])],
  ])("returns empty string for %s node (no value)", (_name, node) => {
    expect(getNodeValue(node)).toBe("");
  });

  it("returns value for text with empty string", () => {
    expect(getNodeValue(text(""))).toBe("");
  });
});

// ============================================================================
// Additional parseMarkdown edge cases
// ============================================================================

describe("parseMarkdown edge cases", () => {
  it("handles markdown with only whitespace", async () => {
    const ast = await parseMarkdown("   ");
    expect(ast.nodes).toHaveLength(0);
  });

  it("handles markdown with special characters", async () => {
    const ast = await parseMarkdown('Hello <world> & "quotes"');
    expect(toPlainText(ast)).toBe('Hello <world> & "quotes"');
  });

  it("handles very long markdown input", async () => {
    const ast = await parseMarkdown("word ".repeat(1000));
    expect(ast.nodes.length).toBeGreaterThan(0);
  });

  it("handles markdown with mixed heading levels", async () => {
    const ast = await parseMarkdown("# H1\n## H2\n### H3");
    expect(ast.nodes.map(getNodeTag)).toEqual(["h1", "h2", "h3"]);
  });

  it("handles markdown with thematic break (hr)", async () => {
    const ast = await parseMarkdown("before\n\n---\n\nafter");
    expect(ast.nodes.map(getNodeTag)).toEqual(["p", "hr", "p"]);
  });
});
