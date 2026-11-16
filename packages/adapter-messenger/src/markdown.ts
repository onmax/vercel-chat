import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

export class MessengerFormatConverter extends BaseFormatConverter {
  async fromAst(ast: Root): Promise<string> {
    return (await stringifyMarkdown(ast)).trim();
  }

  toAst(text: string): Promise<Root> {
    return parseMarkdown(text);
  }

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
    return super.renderPostable(message);
  }
}
