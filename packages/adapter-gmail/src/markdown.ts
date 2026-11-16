import {
  BaseFormatConverter,
  type CardElement,
  paragraph,
  type Root,
  root,
  stringifyMarkdown,
  text,
} from "chat";
import { cardToGmailText } from "./cards";

export class GmailFormatConverter extends BaseFormatConverter {
  async toAst(value: string): Promise<Root> {
    return root([paragraph([text(value)])]);
  }

  async fromAst(value: Root): Promise<string> {
    return (await stringifyMarkdown(value)).trimEnd();
  }

  protected override cardToFallbackText(card: CardElement): string {
    return cardToGmailText(card);
  }
}
