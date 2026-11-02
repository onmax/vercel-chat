/**
 * Telegram MarkdownV2 format conversion.
 *
 * Renders markdown AST as Telegram MarkdownV2, which requires escaping
 * special characters outside of entities. This replaces the previous
 * approach of emitting standard markdown with legacy parse_mode "Markdown",
 * which was incompatible (standard markdown uses **bold** while Telegram
 * legacy uses *bold*) and caused "can't parse entities" errors.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */

import {
  BaseFormatConverter,
  type Content,
  getCodeLanguage,
  getListStart,
  getNodeAttributes,
  getNodeChildren,
  getNodeTag,
  getNodeValue,
  isCodeNode,
  isLinkNode,
  isListNode,
  isTableNode,
  parseMarkdown,
  type Root,
  tableToAscii,
} from "chat";

// MarkdownV2 requires escaping these characters in normal text:
// _ * [ ] ( ) ~ ` > # + - = | { } . ! \
const MARKDOWNV2_SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;

// Inside ``` code blocks, only ` and \ need escaping
const CODE_BLOCK_SPECIAL_CHARS = /([`\\])/g;

// Inside (...) of inline links, only ) and \ need escaping
const LINK_URL_SPECIAL_CHARS = /([)\\])/g;

const HEADING_TAG = /^h[1-6]$/;

/**
 * How the adapter intends a message to be rendered.
 *
 * - `"MarkdownV2"` — the body was produced by the MarkdownV2 renderer and
 *   must be parsed by Telegram with `parse_mode: "MarkdownV2"`.
 * - `"plain"` — the body ships verbatim with no markdown parsing (the Bot
 *   API receives no `parse_mode` field).
 *
 * Internal type; the Bot API wire value is obtained via `toBotApiParseMode`.
 */
export type TelegramParseMode = "MarkdownV2" | "plain";

/**
 * Translate the internal parse mode to the Bot API `parse_mode` field.
 * Returns `undefined` for plain messages so the field is omitted.
 */
export function toBotApiParseMode(
  mode: TelegramParseMode
): "MarkdownV2" | undefined {
  return mode === "MarkdownV2" ? "MarkdownV2" : undefined;
}

/** Maximum length of a Telegram text message body in characters. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Maximum length of a media caption (photo/document/etc.) in characters. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

// Entity delimiters whose opener/closer pairing must be preserved when
// truncating a rendered MarkdownV2 string. Telegram reads `__` as underline,
// which pairs separately from single `_` italics.
const MARKDOWN_V2_ENTITY_MARKERS = ["*", "_", "__", "~", "`"] as const;

type EntityMarker = (typeof MARKDOWN_V2_ENTITY_MARKERS)[number];

const MARKDOWN_V2_ELLIPSIS = "\\.\\.\\.";
const PLAIN_ELLIPSIS = "...";

/**
 * Escape text for use in normal MarkdownV2 context (outside entities).
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWNV2_SPECIAL_CHARS, "\\$1");
}

interface DelimiterScan {
  /** Number of `]` that close a link label. */
  closeBrackets: number;
  /**
   * Unescaped entity delimiter positions outside code and link URLs. Fences
   * and `__` record one position per delimiter so a cut through an opener
   * retreats to its first character.
   */
  markers: Record<EntityMarker, number[]>;
  /** Unescaped `[` positions outside code and link URLs. */
  openBrackets: number[];
}

/**
 * Single pass over a MarkdownV2 string collecting every delimiter the trimmer
 * pairs up. Markers inside fenced code, inline code, or the `(...)` part of a
 * link are literal text and are skipped.
 */
function scanDelimiters(text: string): DelimiterScan {
  const markers: Record<EntityMarker, number[]> = {
    "*": [],
    _: [],
    __: [],
    "~": [],
    "`": [],
  };
  const openBrackets: number[] = [];
  let closeBrackets = 0;
  let inFence = false;
  let inInline = false;
  let inLinkUrl = false;
  let backslashes = 0;
  const lastIndex = text.length - 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "\\") {
      backslashes++;
      continue;
    }

    const escaped = backslashes % 2 === 1;
    backslashes = 0;
    if (escaped) {
      continue;
    }

    if (inLinkUrl) {
      // A link's `]` only counts toward bracket pairing once its URL
      // closes, so a slice mid-URL leaves the `[` unmatched.
      if (ch === ")") {
        inLinkUrl = false;
        closeBrackets++;
      }
      continue;
    }

    if (ch === "`") {
      if (!inInline && text.startsWith("```", i)) {
        markers["`"].push(i);
        inFence = !inFence;
        i += 2;
        continue;
      }
      if (inFence) {
        continue;
      }
      markers["`"].push(i);
      // A slice that ends in two opening backticks is a cut fence, not a
      // balanced empty inline-code span.
      if (!inInline && i + 2 === text.length && text[i + 1] === "`") {
        i += 1;
      }
      inInline = !inInline;
      continue;
    }

    if (inFence || inInline) {
      continue;
    }

    if (ch === "[") {
      openBrackets.push(i);
      continue;
    }

    if (ch === "]") {
      if (text[i + 1] === "(") {
        inLinkUrl = true;
        i += 1;
      } else if (i < lastIndex) {
        // Telegram accepts a bare `[label]`; only a `]` that ends the slice
        // may have lost its `(url)` to the cut.
        closeBrackets++;
      }
      continue;
    }

    if (ch === "_") {
      if (text[i + 1] === "_") {
        markers.__.push(i);
        i += 1;
      } else {
        markers._.push(i);
      }
      continue;
    }

    if (ch === "*" || ch === "~") {
      markers[ch].push(i);
    }
  }

  return { markers, openBrackets, closeBrackets };
}

export function endsWithOrphanBackslash(text: string): boolean {
  let trailing = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) {
    trailing++;
  }
  return trailing % 2 === 1;
}

/**
 * Drop any trailing characters that would produce invalid MarkdownV2 after
 * a length-based truncation:
 *
 *  - orphan trailing `\` (would escape the appended ellipsis or nothing)
 *  - unclosed entity delimiter (`*`, `_`, `__`, `~`, `` ` ``) left open
 *    because the slice cut between the opener and its closer
 *  - unmatched `[` from a link whose closer was cut off, or whose `(...)`
 *    URL part was left unterminated by the slice
 *
 * Best-effort: may drop more than strictly necessary in edge cases, but
 * guarantees the output is parseable MarkdownV2 (when the input was).
 *
 * Exported for tests; production callers go through `truncateForTelegram`.
 */
export function trimToMarkdownV2SafeBoundary(text: string): string {
  let current = text;
  const maxIterations = current.length + 1;

  for (let i = 0; i < maxIterations; i++) {
    if (endsWithOrphanBackslash(current)) {
      current = current.slice(0, -1);
      continue;
    }

    const scan = scanDelimiters(current);
    let cut = current.length;

    for (const marker of MARKDOWN_V2_ENTITY_MARKERS) {
      const positions = scan.markers[marker];
      if (positions.length % 2 === 1) {
        cut = Math.min(cut, positions.at(-1) ?? cut);
      }
    }

    if (scan.openBrackets.length > scan.closeBrackets) {
      cut = Math.min(cut, scan.openBrackets.at(-1) ?? cut);
    }

    if (cut >= current.length) {
      return current;
    }

    current = current.slice(0, cut);
  }

  return current;
}

/**
 * Truncate a rendered string to `limit` characters, appending a
 * parse-mode-appropriate ellipsis.
 *
 * Text that fits the limit is returned unchanged: the MarkdownV2 renderer
 * emits balanced entities, so there is nothing to repair, and a trim there
 * could only delete valid content.
 *
 * For MarkdownV2, the naive slice + "..." is unsafe: `.` is reserved and
 * must be escaped, and the slice can leave orphan escape characters (`\`)
 * or cut through a paired entity (`*bold*`, `` `code` ``) resulting in
 * `Bad Request: can't parse entities`. This function uses an escaped
 * ellipsis (`\.\.\.`) and trims back past any unbalanced entity delimiter
 * or orphan backslash before appending.
 */
export function truncateForTelegram(
  text: string,
  limit: number,
  parseMode: TelegramParseMode
): string {
  if (text.length <= limit) {
    return text;
  }

  const isMarkdownV2 = parseMode === "MarkdownV2";
  const ellipsis = isMarkdownV2 ? MARKDOWN_V2_ELLIPSIS : PLAIN_ELLIPSIS;
  let slice = text.slice(0, limit - ellipsis.length);

  if (isMarkdownV2) {
    slice = trimToMarkdownV2SafeBoundary(slice);
  }

  return `${slice}${ellipsis}`;
}

/**
 * Escape text inside code/pre blocks (only ` and \ need escaping).
 */
function escapeCodeBlock(text: string): string {
  return text.replace(CODE_BLOCK_SPECIAL_CHARS, "\\$1");
}

/**
 * Escape text inside link URLs (only ) and \ need escaping).
 */
function escapeLinkUrl(text: string): string {
  return text.replace(LINK_URL_SPECIAL_CHARS, "\\$1");
}

function codeBlock(code: string, lang = ""): string {
  return `\`\`\`${lang}\n${escapeCodeBlock(code)}\n\`\`\``;
}

function renderChildren(node: Content, separator = ""): string {
  return getNodeChildren(node).map(renderMarkdownV2).join(separator);
}

/**
 * Recursively render a node as Telegram MarkdownV2 text.
 */
function renderMarkdownV2(node: Content): string {
  if (typeof node === "string") {
    return escapeMarkdownV2(node);
  }
  if (isCodeNode(node)) {
    return codeBlock(getNodeValue(node), getCodeLanguage(node));
  }
  if (isTableNode(node)) {
    // Telegram renders raw pipe syntax as garbled text.
    return codeBlock(tableToAscii(node));
  }
  if (isLinkNode(node)) {
    return `[${renderChildren(node)}](${escapeLinkUrl(node[1].href)})`;
  }
  if (isListNode(node)) {
    const start = getListStart(node);
    return getNodeChildren(node)
      .map((item, i) => {
        const content = renderChildren(item, "\n");
        if (start !== undefined) {
          return `${escapeMarkdownV2(`${start + i}.`)} ${content}`;
        }
        return `\\- ${content}`;
      })
      .join("\n");
  }

  const tag = getNodeTag(node);
  switch (tag) {
    case "strong":
      return `*${renderChildren(node)}*`;

    case "em":
      return `_${renderChildren(node)}_`;

    case "del":
      return `~${renderChildren(node)}~`;

    case "code":
      return `\`${escapeCodeBlock(getNodeValue(node))}\``;

    case "blockquote":
      return renderChildren(node, "\n")
        .split("\n")
        .map((line) => `>${line}`)
        .join("\n");

    case "li":
      return renderChildren(node, "\n");

    case "hr":
      return escapeMarkdownV2("———");

    case "br":
      return "\n";

    case "img": {
      const { alt = "", src = "" } = getNodeAttributes(node);
      return `[${escapeMarkdownV2(String(alt))}](${escapeLinkUrl(String(src))})`;
    }

    default:
      // Telegram has no heading syntax; render as bold
      if (tag && HEADING_TAG.test(tag)) {
        return `*${renderChildren(node)}*`;
      }
      return renderChildren(node);
  }
}

export class TelegramFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return ast.nodes.map(renderMarkdownV2).join("\n\n").trim();
  }

  toAst(text: string): Promise<Root> {
    return parseMarkdown(text);
  }
}
