---
"chat": minor
---

Add a handler-only `onNewMessage(handler)` overload for messages that reach pattern routing, including attachment-only messages without text. Invalid `onNewMessage` arguments now throw a `ChatError` at registration.
