/**
 * GitHub-specific format conversion using AST-based parsing.
 *
 * GitHub uses GitHub Flavored Markdown (GFM) which is very close to standard markdown.
 * This converter primarily passes through standard markdown, with special handling for:
 * - @mentions (user references)
 * - #refs (issue/PR references)
 * - SHA references (commit links)
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

export class GitHubFormatConverter extends BaseFormatConverter {
  /**
   * GitHub uses standard GFM, so we can stringify the AST directly.
   * We just need to ensure @mentions are preserved.
   */
  async fromAst(ast: Root): Promise<string> {
    return (await stringifyMarkdown(ast)).trim();
  }

  /**
   * Parse GitHub markdown into an AST.
   * GitHub uses standard GFM, so we use the standard parser.
   */
  toAst(markdown: string): Promise<Root> {
    return parseMarkdown(markdown);
  }

  /**
   * Override renderPostable to handle @mentions in plain strings.
   * GitHub @mentions are already in the correct format (@username).
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
