/**
 * WhatsApp-specific format conversion using AST-based parsing.
 *
 * WhatsApp uses a markdown-like format with some differences from standard:
 * - Bold: *text* (single asterisk, not double)
 * - Italic: _text_
 * - Strikethrough: ~text~ (single tilde, not double)
 * - Monospace: ```text```
 *
 * @see https://faq.whatsapp.com/539178204879377
 */

import { normalizeCodeFences } from "@chat-adapter/shared";
import {
  BaseFormatConverter,
  type Content,
  getCodeLanguage,
  getNodeAttributes,
  getNodeChildren,
  getNodeTag,
  getNodeValue,
  isCodeNode,
  isLinkNode,
  isListNode,
  isStrongNode,
  isTableNode,
  isTextNode,
  parseMarkdown,
  type Root,
  tableToAscii,
} from "chat";

// WhatsApp has no escape syntax, so text stays literal unless it would
// otherwise turn into formatting.
const INLINE_PAIRS = {
  "*": /(?:^|[^\p{L}\p{N}])\*(?=\S).*?\S\*(?![\p{L}\p{N}])/mu,
  _: /(?:^|[^\p{L}\p{N}])_(?=\S).*?\S_(?![\p{L}\p{N}])/mu,
  "~": /(?:^|[^\p{L}\p{N}])~(?=\S).*?\S~(?![\p{L}\p{N}])/mu,
  "`": /(?:^|[^\p{L}\p{N}])`(?=\S).*?\S`(?![\p{L}\p{N}])/mu,
} as const;
const BLOCK_START = /(^|\n)(?:([>*-])|(\d+)\.)(?= )/g;
const HEADING_TAG = /^h[1-6]$/;
const LINE_START = /^/gm;
const MARKERS = { strong: "*", em: "_", del: "~" } as const;

// Surrounding markers belong to formatting nodes, so they only bound the text.
function boundary(char: string) {
  return char in INLINE_PAIRS ? " " : char;
}

function escapeText(value: string, before: string, after: string): string {
  const context = [boundary(before), boundary(after)];
  let escaped = value;
  for (const [marker, pair] of Object.entries(INLINE_PAIRS)) {
    const touchesMarker =
      (escaped.startsWith(marker) && before in INLINE_PAIRS) ||
      (escaped.endsWith(marker) && after in INLINE_PAIRS);
    if (
      touchesMarker ||
      (escaped.includes(marker) &&
        pair.test(`${context[0]}${escaped}${context[1]}`))
    ) {
      escaped = escaped.replaceAll(marker, `\\${marker}`);
    }
  }
  return escaped.replace(
    BLOCK_START,
    (match, lead: string, symbol?: string, digits?: string, offset = 0) => {
      if (offset === 0 && lead === "" && before !== "\n") {
        return match;
      }
      return symbol ? `${lead}\\${symbol}` : `${lead}${digits}\\.`;
    }
  );
}

function fence(code: string, lang = ""): string {
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

export class WhatsAppFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to WhatsApp markdown format.
   *
   * Transforms unsupported nodes (headings, thematic breaks, tables)
   * into WhatsApp-compatible equivalents and renders supported formatting
   * directly in WhatsApp syntax.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.blockToWhatsApp(node)
    ).trim();
  }

  private blockToWhatsApp(node: Content): string {
    const tag = getNodeTag(node);
    if (tag && HEADING_TAG.test(tag)) {
      // Flatten nested strong to avoid ***
      const children = getNodeChildren(node).flatMap((child) =>
        isStrongNode(child) ? getNodeChildren(child) : [child]
      );
      return `*${this.inlineToWhatsApp(children, "*", "*")}*`;
    }
    if (tag === "hr") {
      return "━━━";
    }
    if (isTableNode(node)) {
      return fence(tableToAscii(node));
    }
    if (isCodeNode(node)) {
      return fence(getNodeValue(node), getCodeLanguage(node));
    }
    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.blockToWhatsApp(child));
    }
    if (tag === "blockquote") {
      return getNodeChildren(node)
        .map((child) => this.blockToWhatsApp(child))
        .join("\n\n")
        .replace(LINE_START, "> ");
    }
    return this.inlineToWhatsApp(getNodeChildren(node), "\n", "\n");
  }

  /**
   * Render phrasing content. Text is escaped against the characters that end
   * up next to it, so `before` and `after` are what surrounds the run.
   */
  private inlineToWhatsApp(
    children: Content[],
    before: string,
    after: string
  ): string {
    const rendered = children.map((child) =>
      isTextNode(child) ? child : this.inlineNodeToWhatsApp(child)
    );
    let result = "";
    for (const [i, child] of children.entries()) {
      if (isTextNode(child)) {
        const next = rendered[i + 1]?.charAt(0) ?? after;
        result += escapeText(child, result.slice(-1) || before, next);
      } else {
        result += rendered[i];
      }
    }
    return result;
  }

  private inlineNodeToWhatsApp(node: Content): string {
    const tag = getNodeTag(node);
    const children = getNodeChildren(node);
    if (tag === "strong" || tag === "em" || tag === "del") {
      const marker = MARKERS[tag];
      return `${marker}${this.inlineToWhatsApp(children, marker, marker)}${marker}`;
    }
    if (tag === "code") {
      return `\`${getNodeValue(node)}\``;
    }
    if (tag === "br") {
      return "\n";
    }
    if (tag === "img") {
      const { alt = "", src = "" } = getNodeAttributes(node);
      return `![${alt}](${src})`;
    }
    if (isLinkNode(node)) {
      const label = this.inlineToWhatsApp(children, "[", "]");
      return label === node[1].href ? label : `[${label}](${node[1].href})`;
    }
    return this.inlineToWhatsApp(children, "", "");
  }

  /**
   * Parse WhatsApp markdown into an AST.
   *
   * Normalizes WhatsApp's ``` fences for CommonMark (the text after the
   * opening fence is code, not an info string) and transforms
   * WhatsApp-specific formatting to standard markdown outside the fences,
   * then parses with the standard parser.
   */
  toAst(markdown: string): Promise<Root> {
    return parseMarkdown(this.toStandardMarkdown(markdown));
  }

  private toStandardMarkdown(markdown: string): string {
    return normalizeCodeFences(markdown, {
      convertText: (text) => this.fromWhatsAppFormat(text),
    });
  }

  /**
   * Convert WhatsApp format to standard markdown.
   * Converts single-asterisk bold to double-asterisk bold,
   * and single-tilde strikethrough to double-tilde strikethrough.
   *
   * Careful not to convert _italic_ (which is the same in both formats).
   */
  private fromWhatsAppFormat(text: string): string {
    // Convert *bold* to **bold** (single * not preceded/followed by *, no newlines)
    let result = text.replace(
      /(?<!\*)\*(?!\*)([^\n*]+?)(?<!\*)\*(?!\*)/g,
      "**$1**"
    );
    // Convert ~strike~ to ~~strike~~ (single ~ not preceded/followed by ~, no newlines)
    result = result.replace(/(?<!~)~(?!~)([^\n~]+?)(?<!~)~(?!~)/g, "~~$1~~");
    return result;
  }
}
