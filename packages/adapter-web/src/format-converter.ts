import {
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

/**
 * Format converter for the Web adapter.
 *
 * The Web "platform format" is markdown — the browser renders the AST (or the
 * AI SDK UIMessage text parts containing markdown) directly, so no
 * platform-specific markup translation is needed.
 */
export class WebFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Promise<Root> {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): Promise<string> {
    return stringifyMarkdown(ast);
  }
}
