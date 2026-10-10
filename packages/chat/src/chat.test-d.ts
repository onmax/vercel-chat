import { describe, expectTypeOf, it } from "vitest";
import type { Chat, MessageHandler } from "./index";

declare const chat: Chat;
const helpPattern = /help/;

describe("Chat.onNewMessage", () => {
  it("accepts both registration forms", () => {
    const handler: MessageHandler = async () => {};

    expectTypeOf(chat.onNewMessage).toBeCallableWith(handler);
    expectTypeOf(chat.onNewMessage).toBeCallableWith(helpPattern, handler);
  });
});
