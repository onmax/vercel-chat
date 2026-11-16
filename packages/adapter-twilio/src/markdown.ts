import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  codeBlock,
  isTableNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  tableToAscii,
  walkAst,
} from "chat";

export class TwilioFormatConverter extends BaseFormatConverter {
  toAst(text: string): Promise<Root> {
    return parseMarkdown(text);
  }

  async fromAst(ast: Root): Promise<string> {
    const transformed = walkAst(ast, (node: Content) => {
      if (isTableNode(node)) {
        return codeBlock(tableToAscii(node));
      }
      return node;
    });
    return (await stringifyMarkdown(transformed)).trim();
  }

  async renderPostable(message: AdapterPostableMessage): Promise<string> {
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
    return super.renderPostable(message);
  }
}
