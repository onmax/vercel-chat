/**
 * Discord-specific format conversion using AST-based parsing.
 *
 * Discord uses standard markdown with some extensions:
 * - Bold: **text** (standard)
 * - Italic: *text* or _text_ (standard)
 * - Strikethrough: ~~text~~ (standard GFM)
 * - Links: [text](url) (standard)
 * - User mentions: <@userId>
 * - Channel mentions: <#channelId>
 * - Role mentions: <@&roleId>
 * - Custom emoji: <:name:id> or <a:name:id> (animated)
 * - Spoiler: ||text||
 */

import { replaceBareMentions } from "@chat-adapter/shared";
import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  getCodeLanguage,
  getNodeChildren,
  getNodeTag,
  getNodeValue,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableNode,
  isTextNode,
  type Link,
  parseMarkdown,
  type Root,
  root,
  tableToAscii,
  toPlainText,
} from "chat";

const SUPPRESSABLE_URL_REGEX = /^https?:\/\/[^<>\s]+$/i;

// biome-ignore lint/style/noEnum: Link styles must use an enum.
enum DiscordLinkStyle {
  SuppressedAutolink = "suppressed-autolink",
  SuppressedMaskedLink = "suppressed-masked-link",
}

/**
 * Source style of links parsed from Discord markdown. Comark keeps no source
 * positions and would write extra attributes back out as `{key="value"}`, so
 * the style lives beside the node.
 */
const discordLinkStyles = new WeakMap<Link, DiscordLinkStyle>();

function getDiscordLinkStyle(
  markdown: string,
  node: Link
): DiscordLinkStyle | undefined {
  const { href } = node[1];
  if (!SUPPRESSABLE_URL_REGEX.test(href)) {
    return;
  }
  const masked = markdown.split(`](<${href}>)`).length - 1;
  const bracketed = markdown.split(`<${href}>`).length - 1;
  // `<url>` parses to a link labeled with its URL, like a bare URL does.
  if (toPlainText(root(getNodeChildren(node))) === href && bracketed > masked) {
    return DiscordLinkStyle.SuppressedAutolink;
  }
  if (masked > 0) {
    return DiscordLinkStyle.SuppressedMaskedLink;
  }
}

export class DiscordFormatConverter extends BaseFormatConverter {
  /**
   * Convert bare `@mentions` to Discord format (`@name` → `<@name>`), leaving
   * emails, URLs, code spans, and existing `<@…>` tokens untouched.
   */
  private convertMentionsToDiscord(text: string): string {
    return replaceBareMentions(text, (_mention, name) => `<@${name}>`);
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override async renderPostable(
    message: AdapterPostableMessage
  ): Promise<string> {
    if (typeof message === "string") {
      return this.convertMentionsToDiscord(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToDiscord(message.raw);
    }
    if ("markdown" in message) {
      return this.fromAst(await this.parseDiscordMarkdown(message.markdown));
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return "";
  }

  /**
   * Render an AST to Discord markdown format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToDiscordMarkdown(node)
    );
  }

  /**
   * Parse Discord markdown into an AST.
   */
  toAst(discordMarkdown: string): Promise<Root> {
    return this.parseDiscordMarkdown(this.toStandardMarkdown(discordMarkdown));
  }

  /**
   * Convert Discord-specific formats to standard markdown.
   */
  private toStandardMarkdown(discordMarkdown: string): string {
    let markdown = discordMarkdown;

    // User mentions: <@userId> or <@!userId> -> @userId
    markdown = markdown.replace(/<@!?(\w+)>/g, "@$1");

    // Channel mentions: <#channelId> -> #channelId
    markdown = markdown.replace(/<#(\w+)>/g, "#$1");

    // Role mentions: <@&roleId> -> @&roleId
    markdown = markdown.replace(/<@&(\w+)>/g, "@&$1");

    // Custom emoji: <:name:id> or <a:name:id> -> :name:
    markdown = markdown.replace(/<a?:(\w+):\d+>/g, ":$1:");

    // Spoiler tags: ||text|| -> [spoiler: text]
    // (no direct markdown equivalent, convert to placeholder)
    markdown = markdown.replace(/\|\|([^|]+)\|\|/g, "[spoiler: $1]");

    return markdown;
  }

  /**
   * Parsing normalizes Discord's two angle-bracketed link forms, so record
   * their source style before rendering.
   */
  private async parseDiscordMarkdown(markdown: string): Promise<Root> {
    const ast = await parseMarkdown(markdown);
    this.markDiscordLinkStyles(ast.nodes, markdown);
    return ast;
  }

  private markDiscordLinkStyles(nodes: Content[], markdown: string): void {
    for (const node of nodes) {
      if (isLinkNode(node)) {
        const discordLinkStyle = getDiscordLinkStyle(markdown, node);
        if (discordLinkStyle !== undefined) {
          discordLinkStyles.set(node, discordLinkStyle);
        }
      }

      this.markDiscordLinkStyles(getNodeChildren(node), markdown);
    }
  }

  private nodeToDiscordMarkdown(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Convert bare @mentions to Discord format <@mention>
      return this.convertMentionsToDiscord(node);
    }

    if (isStrongNode(node)) {
      // Standard markdown **text**
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `**${content}**`;
    }

    if (isEmphasisNode(node)) {
      // Standard markdown *text*
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `*${content}*`;
    }

    if (isDeleteNode(node)) {
      // Standard GFM ~~text~~
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `~~${content}~~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${getNodeValue(node)}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`${getCodeLanguage(node) || ""}\n${getNodeValue(node)}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const children = getNodeChildren(node);
      const linkText = children
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      const { href } = node[1];
      const discordLinkStyle = discordLinkStyles.get(node);
      if (discordLinkStyle === DiscordLinkStyle.SuppressedAutolink) {
        return `<${href}>`;
      }
      if (discordLinkStyle === DiscordLinkStyle.SuppressedMaskedLink) {
        return `[${linkText}](<${href}>)`;
      }

      // Bare URLs (label === url) must stay bare: Discord only renders masked
      // links `[text](url)` inside embeds, so `[url](url)` in a normal message
      // shows up as literal text instead of a clickable link.
      if (linkText === href) {
        return href;
      }
      // Standard markdown [text](url)
      return `[${linkText}](${href})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToDiscordMarkdown(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return this.renderList(node, 0, (child) =>
        this.nodeToDiscordMarkdown(child)
      );
    }

    if (getNodeTag(node) === "br") {
      return "\n";
    }

    if (getNodeTag(node) === "hr") {
      return "---";
    }

    if (isTableNode(node)) {
      return `\`\`\`\n${tableToAscii(node)}\n\`\`\``;
    }

    return this.defaultNodeToText(node, (child) =>
      this.nodeToDiscordMarkdown(child)
    );
  }
}
