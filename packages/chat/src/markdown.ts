/**
 * Markdown parsing and conversion utilities using Comark.
 */

import type {
  ElementNode,
  ElementNodeAttributes,
  MarkdownDocument,
  Node,
  RenderMarkdownOptions,
} from "comark";
import { createMarkdownParser } from "comark/core";
import linkify from "comark/plugins/linkify";
import { renderMarkdown } from "comark/render";
import type { CardChild, CardElement, ChartElement } from "./cards";
import type { AdapterPostableMessage } from "./types";

// Alias for use within this file
type PostableMessageInput = AdapterPostableMessage;

const LINE_BREAK_REGEX = /\r\n|\r|\n/;

type Element<TTag extends string, TAttributes = ElementNodeAttributes> = [
  TTag,
  TAttributes & ElementNodeAttributes,
  ...Node[],
];

/** The parsed document. Its `nodes` are the top-level blocks. */
export type Root = MarkdownDocument;
/** Any node: a string for text, a `[tag, attributes, ...children]` tuple for an element. */
export type Content = Node;
export type Nodes = Node;
export type Text = string;
export type Paragraph = Element<"p">;
export type Strong = Element<"strong">;
export type Emphasis = Element<"em">;
export type Delete = Element<"del">;
export type InlineCode = Element<"code">;
export type Code = Element<"pre", { language?: string }>;
export type Link = Element<"a", { href: string; title?: string }>;
export type Blockquote = Element<"blockquote">;
export type List = Element<"ul"> | Element<"ol", { start?: string }>;
export type ListItem = Element<"li">;
export type Table = Element<"table">;
export type TableRow = Element<"tr">;
export type TableCell = Element<"th" | "td">;

// ============================================================================
// Type guards and accessors
// ============================================================================

/** The tag of an element node, or `undefined` for text and comments. */
export function getNodeTag(node: Content): string | undefined {
  return Array.isArray(node) && node[0] !== null ? node[0] : undefined;
}

function hasTag<T extends ElementNode>(...tags: string[]) {
  return (node: Content): node is T => tags.includes(getNodeTag(node) ?? "");
}

export function isTextNode(node: Content): node is Text {
  return typeof node === "string";
}

export const isParagraphNode = hasTag<Paragraph>("p");
export const isStrongNode = hasTag<Strong>("strong");
export const isEmphasisNode = hasTag<Emphasis>("em");
export const isDeleteNode = hasTag<Delete>("del");
export const isInlineCodeNode = hasTag<InlineCode>("code");
export const isCodeNode = hasTag<Code>("pre");
export const isLinkNode = hasTag<Link>("a");
export const isBlockquoteNode = hasTag<Blockquote>("blockquote");
export const isListNode = hasTag<List>("ul", "ol");
export const isListItemNode = hasTag<ListItem>("li");
export const isTableNode = hasTag<Table>("table");
export const isTableRowNode = hasTag<TableRow>("tr");
export const isTableCellNode = hasTag<TableCell>("th", "td");

/** Children of an element node. Empty for text and comments. */
export function getNodeChildren(node: Content): Content[] {
  return getNodeTag(node) === undefined
    ? []
    : ((node as ElementNode).slice(2) as Content[]);
}

/** Attributes of an element node. Empty for text and comments. */
export function getNodeAttributes(node: Content): ElementNodeAttributes {
  return getNodeTag(node) === undefined ? {} : (node as ElementNode)[1];
}

/**
 * Text of a leaf: the string itself for text, the code for inline code and
 * code blocks. Empty for other nodes.
 */
export function getNodeValue(node: Content): string {
  if (typeof node === "string") {
    return node;
  }
  if (isInlineCodeNode(node) || isCodeNode(node)) {
    return toPlainText(root(getNodeChildren(node)));
  }
  return "";
}

/** Language of a code block, if it has one. */
export function getCodeLanguage(node: Code): string | undefined {
  return node[1].language || undefined;
}

/** Start number of an ordered list, or `undefined` for an unordered one. */
export function getListStart(node: List): number | undefined {
  return node[0] === "ol" ? Number(node[1].start ?? 1) : undefined;
}

function tableRows(node: Content): TableRow[] {
  return getNodeChildren(node).flatMap((child) =>
    isTableRowNode(child) ? [child] : tableRows(child)
  );
}

/**
 * Render a table node as a padded ASCII table string.
 *
 * Produces output like:
 * ```
 * Name  | Age | Role
 * ------|-----|--------
 * Alice | 30  | Engineer
 * Bob   | 25  | Designer
 * ```
 *
 * Shared by adapters that lack native table support (Slack, GChat, Discord, Telegram).
 */
export function tableToAscii(node: Table): string {
  const rows = tableRows(node).map((row) =>
    getNodeChildren(row).map((cell) => plainTextNode(cell))
  );
  if (rows.length === 0) {
    return "";
  }
  return tableElementToAscii(rows[0], rows.slice(1));
}

/**
 * Render a table from headers and string rows as a padded ASCII table.
 * Used for card TableElement fallback rendering.
 */
export function tableElementToAscii(
  headers: string[],
  rows: string[][]
): string {
  const allRows = [headers, ...rows];
  const colCount = Math.max(...allRows.map((r) => r.length));
  if (colCount === 0) {
    return "";
  }
  const colWidths: number[] = Array.from({ length: colCount }, () => 0);

  for (const row of allRows) {
    for (let i = 0; i < colCount; i++) {
      const cellLen = (row[i] || "").length;
      if (cellLen > colWidths[i]) {
        colWidths[i] = cellLen;
      }
    }
  }

  const formatRow = (cells: string[]): string =>
    Array.from({ length: colCount }, (_, i) =>
      (cells[i] || "").padEnd(colWidths[i])
    )
      .join(" | ")
      .trimEnd();

  const lines: string[] = [];
  lines.push(formatRow(headers));
  lines.push(colWidths.map((w) => "-".repeat(w)).join("-|-"));
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  return lines.join("\n");
}

/**
 * Render a chart element as text: the title followed by the underlying
 * data as a padded ASCII table.
 * Used for card ChartElement fallback rendering on platforms without
 * native chart support.
 */
export function chartElementToFallbackText(element: ChartElement): string {
  const { chart, title } = element;

  if (chart.type === "pie") {
    const table = tableElementToAscii(
      ["Label", "Value"],
      chart.segments.map((s) => [s.label, String(s.value)])
    );
    return `${title}\n${table}`;
  }

  const headers = [chart.xLabel ?? "", ...chart.series.map((s) => s.name)];
  const rows = chart.categories.map((category) => [
    category,
    ...chart.series.map((s) => {
      const point = s.data.find((p) => p.label === category);
      return point ? String(point.value) : "";
    }),
  ]);
  return `${title}\n${tableElementToAscii(headers, rows)}`;
}

/**
 * Default maximum length of inbound message text that
 * `BaseFormatConverter.parseIncoming` parses as markdown.
 */
export const DEFAULT_MAX_INCOMING_PARSE_LENGTH = 16_384;

/**
 * Default maximum nesting depth of an AST built by
 * `BaseFormatConverter.parseIncoming`. Recursive serializers such as
 * `JSON.stringify` overflow the stack on trees a few thousand levels deep.
 * The parser stops at 100 levels of block nesting and drops the rest of the
 * document, so a tree that reaches 100 levels may be cut short and is kept
 * as text instead.
 */
const DEFAULT_MAX_INCOMING_AST_DEPTH = 99;

function exceedsDepth(ast: Root, max: number): boolean {
  const stack: [Content, number][] = ast.nodes.map((node) => [node, 1]);
  let entry = stack.pop();
  while (entry) {
    const [node, depth] = entry;
    if (depth > max) {
      return true;
    }
    for (const child of getNodeChildren(node)) {
      stack.push([child, depth + 1]);
    }
    entry = stack.pop();
  }
  return false;
}

// Comark's own syntax (components, attributes, raw HTML) is off, so `{x}` and
// `::x` in a chat message stay text. Incoming text is complete, so nothing is
// auto-closed, and list items keep their paragraphs, as in CommonMark.
const parser = createMarkdownParser({
  autoUnwrap: false,
  headingIds: false,
  plugins: [linkify()],
});

/**
 * Parse markdown string into an AST.
 * Supports GFM (GitHub Flavored Markdown) for strikethrough, tables, etc.
 */
export function parseMarkdown(markdown: string): Promise<Root> {
  return parser(markdown);
}

/**
 * Options for stringifyMarkdown.
 */
export interface StringifyOptions {
  /**
   * Custom serializers keyed by tag. Each replaces the default serializer
   * for that tag and is responsible for its own escaping.
   */
  handlers?: RenderMarkdownOptions["components"];
}

/**
 * Stringify an AST back to markdown.
 */
export function stringifyMarkdown(
  ast: Root,
  options?: StringifyOptions
): Promise<string> {
  return renderMarkdown(ast, { components: options?.handlers });
}

function childPlainText(
  node: Content,
  separator: string,
  keepEmpty = false
): string {
  const texts = getNodeChildren(node).map(plainTextNode);
  return (keepEmpty ? texts : texts.filter((text) => text.length > 0)).join(
    separator
  );
}

function plainTextNode(node: Content): string {
  if (typeof node === "string") {
    return node;
  }
  switch (getNodeTag(node)) {
    case undefined:
      return "";
    case "img":
      return String(getNodeAttributes(node).alt ?? "");
    case "ul":
    case "ol":
    case "li":
    case "blockquote":
      return childPlainText(node, "\n");
    case "table":
    case "thead":
    case "tbody":
      // Drop rows with no content (e.g. a placeholder header row) but keep
      // rows that have any populated cell.
      return tableRows(node)
        .map(plainTextNode)
        .filter((row) => row.trim().length > 0)
        .join("\n");
    case "tr":
      // Keep empty cells so columns stay aligned in the tab-separated output
      return childPlainText(node, "\t", true);
    case "br":
      return "\n";
    default:
      return childPlainText(node, "");
  }
}

/**
 * Extract plain text from an AST (strips all formatting).
 */
export function toPlainText(ast: Root): string {
  return ast.nodes
    .map(plainTextNode)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/**
 * Extract plain text from a markdown string.
 */
export async function markdownToPlainText(markdown: string): Promise<string> {
  return toPlainText(await parseMarkdown(markdown));
}

/**
 * Walk the AST and transform nodes.
 */
export function walkAst<T extends Content | Root>(
  node: T,
  visitor: (node: Content) => Content | null
): T {
  const walk = (children: Content[]): Content[] =>
    children.flatMap((child) => {
      const result = visitor(child);
      if (result === null) {
        return [];
      }
      if (getNodeTag(result) === undefined) {
        return [result];
      }
      const [tag, attributes, ...rest] = result as ElementNode;
      return [[tag, attributes, ...walk(rest)] as ElementNode];
    });
  if (!Array.isArray(node) && typeof node === "object") {
    return { ...node, nodes: walk((node as Root).nodes) };
  }
  return walk([node as Content])[0] as T;
}

/**
 * Create a text node.
 */
export function text(value: string): Text {
  return value;
}

/**
 * Create a strong (bold) node.
 */
export function strong(children: Content[]): Strong {
  return ["strong", {}, ...children];
}

/**
 * Create an emphasis (italic) node.
 */
export function emphasis(children: Content[]): Emphasis {
  return ["em", {}, ...children];
}

/**
 * Create a delete (strikethrough) node.
 */
export function strikethrough(children: Content[]): Delete {
  return ["del", {}, ...children];
}

/**
 * Create an inline code node.
 */
export function inlineCode(value: string): InlineCode {
  return ["code", {}, value];
}

/**
 * Create a code block node.
 */
export function codeBlock(value: string, lang?: string): Code {
  return lang
    ? [
        "pre",
        { language: lang },
        ["code", { class: `language-${lang}` }, value],
      ]
    : ["pre", {}, ["code", {}, value]];
}

/**
 * Create a link node.
 */
export function link(url: string, children: Content[], title?: string): Link {
  return ["a", title ? { href: url, title } : { href: url }, ...children];
}

/**
 * Create a blockquote node.
 */
export function blockquote(children: Content[]): Blockquote {
  return ["blockquote", {}, ...children];
}

/**
 * Create a paragraph node.
 */
export function paragraph(children: Content[]): Paragraph {
  return ["p", {}, ...children];
}

/**
 * Create a root node (top-level AST container).
 */
export function root(children: Content[]): Root {
  return { nodes: children, frontmatter: {}, meta: {} };
}

/**
 * Interface for platform-specific format converters.
 *
 * The AST (Comark document) is the canonical representation.
 * All conversions go through the AST:
 *
 *   Platform Format <-> AST <-> Markdown String
 *
 * Adapters implement this interface to convert between
 * their platform-specific format and the standard AST.
 */
export interface FormatConverter {
  /**
   * Extract plain text from platform format.
   * Convenience method - default implementation uses toAst + toPlainText.
   */
  extractPlainText(platformText: string): Promise<string>;
  /**
   * Render an AST to the platform's native format.
   * This is the primary method used when sending messages.
   */
  fromAst(ast: Root): string | Promise<string>;

  /**
   * Parse platform's native format into an AST.
   * This is the primary method used when receiving messages.
   */
  toAst(platformText: string): Promise<Root>;
}

/**
 * @deprecated Use FormatConverter instead
 */
export interface MarkdownConverter extends FormatConverter {
  // Convenience methods for markdown string I/O
  fromMarkdown(markdown: string): Promise<string>;
  toMarkdown(platformText: string): Promise<string>;
  toPlainText(platformText: string): Promise<string>;
}

/**
 * Base class for format converters with default implementations.
 */
export abstract class BaseFormatConverter implements FormatConverter {
  abstract fromAst(ast: Root): string | Promise<string>;
  abstract toAst(platformText: string): Promise<Root>;

  /**
   * Whether `renderList` indents every line of a multi-line block in a list
   * item, such as a code block or block quote, to the item's content column.
   * Enable it for CommonMark targets, where an unindented line leaves the
   * item. Nested lists are always indented.
   */
  protected indentListContinuationLines = false;

  protected renderList(
    node: List,
    depth: number,
    nodeConverter: (node: Content) => string,
    unorderedBullet = "-"
  ): string {
    return this.renderListLines(
      node,
      "  ".repeat(depth),
      nodeConverter,
      unorderedBullet
    ).join("\n");
  }

  private renderListLines(
    node: List,
    indent: string,
    nodeConverter: (node: Content) => string,
    unorderedBullet: string
  ): string[] {
    const start = getListStart(node);
    const lines: string[] = [];
    for (const [i, item] of getNodeChildren(node).entries()) {
      const prefix = start === undefined ? unorderedBullet : `${start + i}.`;
      const marker = `${indent}${prefix} `;
      // Content after the marker starts at this column, so "1. " needs
      // three spaces for a nested list to stay inside the item.
      const contentIndent = " ".repeat(marker.length);
      let previous: Content | undefined;
      for (const child of getNodeChildren(item)) {
        if (isListNode(child)) {
          const nested = this.renderListLines(
            child,
            contentIndent,
            nodeConverter,
            unorderedBullet
          );
          if (nested.length === 0) {
            continue;
          }
          if (previous) {
            // An ordered list that doesn't start at 1 can't interrupt a
            // paragraph, so it needs a blank line before it.
            if ((getListStart(child) ?? 1) !== 1) {
              lines.push("");
            }
            lines.push(...nested);
          } else {
            lines.push(`${marker}${nested[0].slice(contentIndent.length)}`);
            lines.push(...nested.slice(1));
          }
          previous = child;
          continue;
        }
        const text = nodeConverter(child);
        if (!text.trim()) {
          continue;
        }
        const [firstLine, ...rest] = text.split(LINE_BREAK_REGEX);
        if (previous) {
          // Two blocks need a blank line between them or they merge.
          lines.push("", `${contentIndent}${firstLine}`);
        } else {
          lines.push(`${marker}${firstLine}`);
        }
        for (const line of rest) {
          lines.push(
            this.indentListContinuationLines && line
              ? `${contentIndent}${line}`
              : line
          );
        }
        previous = child;
      }
    }
    return lines;
  }

  /**
   * Default fallback for converting an unknown node to text.
   * Recursively converts children if present, otherwise extracts the node value.
   * Adapters should call this in their nodeToX() default case.
   */
  protected defaultNodeToText(
    node: Content,
    nodeConverter: (node: Content) => string
  ): string {
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map(nodeConverter).join("");
    }
    return getNodeValue(node);
  }

  /**
   * Template method for implementing fromAst with a node converter.
   * Iterates through AST children and converts each using the provided function.
   * Joins results with double newlines (standard paragraph separation).
   *
   * @param ast - The AST to convert
   * @param nodeConverter - Function to convert each Content node to string
   * @returns Platform-formatted string
   */
  protected fromAstWithNodeConverter(
    ast: Root,
    nodeConverter: (node: Content) => string
  ): string {
    return ast.nodes.map(nodeConverter).join("\n\n");
  }

  async extractPlainText(platformText: string): Promise<string> {
    return toPlainText(await this.toAst(platformText));
  }

  /**
   * Maximum length, in UTF-16 code units, of inbound text that
   * `parseIncoming` will parse as markdown. Longer text is kept verbatim in
   * a single text node.
   * Subclasses can override this to match their platform's limits.
   */
  protected maxIncomingParseLength = DEFAULT_MAX_INCOMING_PARSE_LENGTH;

  /**
   * Maximum nesting depth of the AST `parseIncoming` returns. Text that
   * parses deeper is kept verbatim in a single text node.
   */
  protected maxIncomingAstDepth = DEFAULT_MAX_INCOMING_AST_DEPTH;

  /**
   * Parse inbound platform text into the plain text and AST for a `Message`.
   * Parses once. Text longer than `maxIncomingParseLength`, that overflows
   * the stack while parsing, or that parses deeper than `maxIncomingAstDepth`
   * is kept verbatim in a single text node.
   */
  async parseIncoming(
    platformText: string
  ): Promise<{ formatted: Root; text: string }> {
    if (this.exceedsIncomingBudget(platformText)) {
      return this.unparsedIncoming(platformText);
    }
    let formatted: Root;
    try {
      formatted = await this.toAst(platformText);
    } catch (error) {
      if (error instanceof RangeError) {
        return this.unparsedIncoming(platformText);
      }
      throw error;
    }
    if (exceedsDepth(formatted, this.maxIncomingAstDepth)) {
      return this.unparsedIncoming(platformText);
    }
    return { text: toPlainText(formatted), formatted };
  }

  /**
   * Whether inbound text is too long to parse. Comark parses in linear time,
   * so length is the only limit.
   */
  protected exceedsIncomingBudget(platformText: string): boolean {
    return platformText.length > this.maxIncomingParseLength;
  }

  /**
   * Text to keep when `parseIncoming` skips markdown parsing. Converters whose
   * platform text carries markup that shouldn't reach users, such as entities
   * or mention tokens, can override this. It must run in linear time.
   */
  protected incomingFallbackText(platformText: string): string {
    return platformText;
  }

  /**
   * Build the unformatted result `parseIncoming` returns when it skips
   * markdown parsing.
   */
  protected unparsedIncoming(platformText: string): {
    formatted: Root;
    text: string;
  } {
    const fallback = this.incomingFallbackText(platformText);
    return {
      text: fallback,
      formatted: root([paragraph([text(fallback)])]),
    };
  }

  // Convenience methods for markdown string I/O
  async fromMarkdown(markdown: string): Promise<string> {
    return this.fromAst(await parseMarkdown(markdown));
  }

  async toMarkdown(platformText: string): Promise<string> {
    return stringifyMarkdown(await this.toAst(platformText));
  }

  /** @deprecated Use extractPlainText instead */
  toPlainText(platformText: string): Promise<string> {
    return this.extractPlainText(platformText);
  }

  /**
   * Convert a PostableMessage to platform format (text only).
   * - string: passed through as raw text (no conversion)
   * - { raw: string }: passed through as raw text (no conversion)
   * - { markdown: string }: converted from markdown to platform format
   * - { ast: Root }: converted from AST to platform format
   * - { card: CardElement }: returns fallback text (cards should be handled by adapter)
   * - CardElement: returns fallback text (cards should be handled by adapter)
   *
   * Note: For cards, adapters should check for card content first and render
   * them using platform-specific card APIs, using this method only for fallback.
   */
  async renderPostable(message: PostableMessageInput): Promise<string> {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    if ("card" in message) {
      // Card with fallback text or generate from card content
      return message.fallbackText || this.cardToFallbackText(message.card);
    }
    if ("type" in message && message.type === "card") {
      // Direct CardElement
      return this.cardToFallbackText(message);
    }
    // Should never reach here with proper typing
    throw new Error("Invalid PostableMessage format");
  }

  /**
   * Generate fallback text from a card element.
   * Override in subclasses for platform-specific formatting.
   */
  protected cardToFallbackText(card: CardElement): string {
    const parts: string[] = [];

    if (card.title) {
      parts.push(`**${card.title}**`);
    }

    if (card.subtitle) {
      parts.push(card.subtitle);
    }

    for (const child of card.children) {
      const text = this.cardChildToFallbackText(child);
      if (text) {
        parts.push(text);
      }
    }

    return parts.join("\n");
  }

  /**
   * Convert card child element to fallback text.
   */
  protected cardChildToFallbackText(child: CardChild): string | null {
    switch (child.type) {
      case "text":
        return child.content;
      case "fields":
        return child.children
          .map((f) => `**${f.label}**: ${f.value}`)
          .join("\n");
      case "actions":
        // Actions are interactive-only — exclude from fallback text.
        // See: https://docs.slack.dev/reference/methods/chat.postMessage
        return null;
      case "table":
        return tableElementToAscii(child.headers, child.rows);
      case "chart":
        return chartElementToFallbackText(child);
      case "text_input":
        // An empty box carries no text of its own.
        return child.label;
      case "section":
        return child.children
          .map((c) => this.cardChildToFallbackText(c))
          .filter(Boolean)
          .join("\n");
      default:
        return null;
    }
  }
}
