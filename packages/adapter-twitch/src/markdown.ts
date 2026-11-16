import {
  BaseFormatConverter,
  type CardElement,
  type Content,
  getNodeChildren,
  getNodeTag,
  getNodeValue,
  isCodeNode,
  isLinkNode,
  isListNode,
  isTableNode,
  isTableRowNode,
  isTextNode,
  link,
  paragraph,
  type Root,
  root,
  text,
} from "chat";
import { cardToTwitchText } from "./cards";
import { tableToTwitchText } from "./table";

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;
const LINE_BREAKS = /\s*\n+\s*/g;

/**
 * Format converter for Twitch chat.
 *
 * Twitch chat renders plain, single-line text. Inbound text is parsed as plain
 * text (never as markdown: emote names and `*action*` text would misparse)
 * with URLs promoted to link nodes. Outbound ASTs are flattened to plain text,
 * and line breaks collapse to spaces because chat messages are one line.
 */
export class TwitchFormatConverter extends BaseFormatConverter {
  async toAst(platformText: string): Promise<Root> {
    return this.plainTextToAst(platformText);
  }

  /** Parse chat text into one paragraph with link nodes. */
  plainTextToAst(platformText: string): Root {
    if (!platformText) {
      return root([]);
    }
    return root([paragraph(splitLinks(platformText))]);
  }

  fromAst(ast: Root): string {
    return toSingleLine(
      this.fromAstWithNodeConverter(ast, (node) => this.nodeToText(node))
    );
  }

  protected override cardToFallbackText(card: CardElement): string {
    return cardToTwitchText(card);
  }

  protected nodeToText(node: Content): string {
    if (isTextNode(node)) {
      return getNodeValue(node);
    }
    if (isLinkNode(node)) {
      const label = getNodeChildren(node)
        .map((child) => this.nodeToText(child))
        .join("");
      const url = node[1].href;
      return label && label !== url ? `${label} (${url})` : url;
    }
    if (isCodeNode(node)) {
      return getNodeValue(node);
    }
    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.nodeToText(child), "•");
    }
    if (isTableNode(node)) {
      const [headerRow, ...bodyRows] = getNodeChildren(node).flatMap(
        (section) =>
          isTableRowNode(section) ? [section] : getNodeChildren(section)
      );
      return tableToTwitchText(
        headerRow ? this.rowToCells(headerRow) : [],
        bodyRows.map((row) => this.rowToCells(row))
      );
    }
    if (getNodeTag(node) === "br") {
      return "\n";
    }
    if (getNodeTag(node) === "hr") {
      return "";
    }
    return this.defaultNodeToText(node, (child) => this.nodeToText(child));
  }

  private rowToCells(row: Content): string[] {
    return getNodeChildren(row).map((cell) =>
      getNodeChildren(cell)
        .map((child) => this.nodeToText(child))
        .join("")
    );
  }
}

/** Collapse line breaks (and the whitespace around them) to single spaces. */
export function toSingleLine(value: string): string {
  return value.replace(LINE_BREAKS, " ").trim();
}

function splitLinks(block: string): Content[] {
  const children: Content[] = [];
  let lastIndex = 0;
  for (const match of block.matchAll(URL_PATTERN)) {
    if (match.index > lastIndex) {
      children.push(text(block.slice(lastIndex, match.index)));
    }
    children.push(link(match[0], [text(match[0])]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < block.length) {
    children.push(text(block.slice(lastIndex)));
  }
  return children;
}
