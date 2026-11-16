/**
 * Linear-specific format conversion using AST-based parsing.
 *
 * Linear uses standard Markdown for comments, which is very close
 * to the AST format used by the SDK. This converter is mostly
 * pass-through, similar to the GitHub adapter.
 *
 * @see https://linear.app/docs/comment-on-issues
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

export class LinearFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to standard markdown.
   * Linear uses standard markdown, so we stringify the AST directly.
   */
  async fromAst(ast: Root): Promise<string> {
    return (await stringifyMarkdown(ast)).trim();
  }

  /**
   * Parse markdown into an AST.
   * Linear uses standard markdown, so we use the standard parser.
   */
  toAst(markdown: string): Promise<Root> {
    return parseMarkdown(markdown);
  }

  /**
   * Render a postable message to Linear markdown string.
   */
  override async renderPostable(
    message: AdapterPostableMessage
  ): Promise<string> {
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
    // Handle cards via base class
    return super.renderPostable(message);
  }
}
