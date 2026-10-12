---
"@chat-adapter/teams": patch
---

Classify Teams bot senders using their account role, bot account ID, and the adapter's own identity. Messages, reactions, card actions, and dialog events now report `isBot` and `isMe` consistently, so handlers can exclude bot activity from human-only conversations. Cached user lookups no longer report bot account IDs as humans.
