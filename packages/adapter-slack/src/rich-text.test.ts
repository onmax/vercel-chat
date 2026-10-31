import {
  type Content,
  getNodeTag,
  getNodeValue,
  stringifyMarkdown,
  toPlainText,
} from "chat";
import { describe, expect, it } from "vitest";
import type { SlackEvent, SlackMessageBlock } from "./event";
import { SlackFormatConverter } from "./markdown";
import { richTextBody } from "./rich-text";

const converter = new SlackFormatConverter();

/** A one-item unordered list holding `children`. */
const listOf = (...children: Content[]): Content[] => [
  ["ul", {}, ["li", {}, ...children]],
];

type Style = SlackMessageBlock["style"];

const text = (value: string, style?: Style): SlackMessageBlock => ({
  type: "text",
  text: value,
  ...(style ? { style } : {}),
});
const section = (...elements: SlackMessageBlock[]): SlackMessageBlock => ({
  type: "rich_text_section",
  elements,
});
const list = (
  items: SlackMessageBlock[],
  options: { indent?: number; offset?: number; style?: string } = {}
): SlackMessageBlock =>
  // Slack sends a list's `style` as a string, which the inline style type
  // does not describe.
  ({
    type: "rich_text_list",
    style: options.style ?? "bullet",
    indent: options.indent ?? 0,
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    elements: items,
  }) as unknown as SlackMessageBlock;
const event = (
  elements: SlackMessageBlock[],
  overrides: Partial<SlackEvent> = {}
): SlackEvent => ({
  type: "message",
  text: "fallback",
  blocks: [{ type: "rich_text", elements }],
  ...overrides,
});

/** The body as mrkdwn, and as markdown after the adapter's format converter. */
async function render(
  value: SlackEvent
): Promise<{ markdown: string; mrkdwn: string }> {
  const mrkdwn = richTextBody(value);
  if (mrkdwn === undefined) {
    throw new Error("expected a rich text body");
  }
  return {
    mrkdwn,
    markdown: await stringifyMarkdown(await converter.toAst(mrkdwn)),
  };
}

/** Render one list item made of `elements`. */
async function item(...elements: SlackMessageBlock[]) {
  return await render(event([list([section(...elements)])]));
}

describe("richTextBody", () => {
  describe("when it applies", () => {
    it("returns undefined without a list, so event.text stays the body", () => {
      expect(richTextBody(event([section(text("plain"))]))).toBeUndefined();
      expect(richTextBody({ type: "message", text: "no blocks" })).toBe(
        undefined
      );
    });

    it("returns undefined when a non-rich-text block carries content", () => {
      expect(
        richTextBody({
          type: "message",
          text: "fallback",
          blocks: [
            { type: "section", fields: [{ type: "mrkdwn", text: "app text" }] },
            { type: "rich_text", elements: [list([section(text("item"))])] },
          ],
        })
      ).toBeUndefined();
    });

    it.each([
      "rich_text_section",
      "rich_text_quote",
      "rich_text_preformatted",
    ])("falls back for unsupported leaves in %s", (type) => {
      const unsupported: SlackMessageBlock = {
        type: "message_mention",
        channel_id: "C123ABC456",
        message_ts: "1720710212.123456",
      };
      expect(
        richTextBody(
          event([
            list([section(text("item"))]),
            { type, elements: [unsupported] },
          ])
        )
      ).toBeUndefined();
    });

    it("falls back for unsupported leaves nested in a list", () => {
      expect(
        richTextBody(
          event([list([section({ type: "future_inline", text: "unhandled" })])])
        )
      ).toBeUndefined();
    });

    it("ignores table blocks, which keep their own handling", () => {
      const body = richTextBody({
        type: "message",
        text: "fallback",
        blocks: [
          { type: "rich_text", elements: [list([section(text("item"))])] },
          { type: "table", rows: [[{ type: "raw_text", text: "cell" }]] },
        ],
      });
      expect(body).toBe("- item");
    });
  });

  describe("lists", () => {
    it("nests a list under the content column of its parent item", async () => {
      const { mrkdwn, markdown } = await render(
        event([
          list([section(text("one"))], { style: "ordered", offset: 9 }),
          list([section(text("nested"))], { indent: 1 }),
          list([section(text("deeper"))], { indent: 2 }),
        ])
      );
      // "10. " is four columns wide, so the child starts at column 4.
      expect(mrkdwn).toBe("10. one\n    - nested\n      - deeper");
      // Comark indents the child by three columns, which moves it out of
      // the item when read back.
      expect(markdown).toBe("10. one\n   - nested\n     - deeper");
    });

    it("continues an ordered list after a nested list", async () => {
      const { markdown } = await render(
        event([
          list([section(text("first"))], { style: "ordered" }),
          list([section(text("child"))], { indent: 1 }),
          list([section(text("second"))], { style: "ordered", offset: 1 }),
        ])
      );
      expect(markdown).toBe("1. first\n   - child\n2. second");
    });

    it("clamps an indent deeper than any open parent", async () => {
      expect(
        await (await render(event([list([section(text("a"))], { indent: 3 })])))
          .mrkdwn
      ).toBe("- a");
    });

    it("indents the continuation lines of a multi-line item", async () => {
      const { markdown } = await item(text("line one\nline two"));
      expect(markdown).toBe("- line one\nline two");
    });

    it("separates lists from surrounding text with a blank line", async () => {
      const { markdown } = await render(
        event([
          section(text("Steps:\n")),
          list([section(text("one"))]),
          section(text("after")),
        ])
      );
      expect(markdown).toBe("Steps:\n\n- one\n\nafter");
    });
  });

  describe("literal list content", () => {
    it.each([
      "---",
      "***",
      "___",
      "===",
      "[x] done",
      "[ ] pending",
      "# heading",
      "> quote",
      "<b>",
      "- flag",
      "+ flag",
      "* flag",
      "1. first",
      "1) first",
      "```",
      "~~~",
      "*literal* _literal_ ~literal~ `literal`",
      "\\*literal*",
    ])("keeps %j literal on first and continuation lines", async (literal) => {
      for (const value of [literal, `before\n${literal}`]) {
        const root = await converter.toAst((await item(text(value))).mrkdwn);
        expect(root.nodes).toEqual(listOf(["p", {}, value]));
        expect(toPlainText(root)).toBe(value);
      }
    });

    it.each([
      "    # heading",
      "\t# heading",
    ])("keeps leading whitespace literal in %j", async (literal) => {
      for (const value of [literal, `before\n${literal}`]) {
        const root = await converter.toAst((await item(text(value))).mrkdwn);
        expect(root.nodes).toEqual(listOf(["p", {}, value]));
        expect(toPlainText(root)).toBe(value);
      }
    });

    it("preserves indentation in text surrounding a list", async () => {
      const root = await converter.toAst(
        await (
          await render(
            event([
              section(text("    # heading")),
              list([section(text("item"))]),
            ])
          )
        ).mrkdwn
      );
      expect(root.nodes).toEqual([
        ["p", {}, "    # heading"],
        ...listOf(["p", {}, "item"]),
      ]);
      expect(toPlainText(root)).toBe("    # heading\n\nitem");
    });

    it("does not turn an indented continuation paragraph into code", async () => {
      const root = await converter.toAst(
        (await item(text("before\n\n    # heading"))).mrkdwn
      );
      expect(root.nodes).toEqual(
        listOf(["p", {}, "before"], ["p", {}, "    # heading"])
      );
      expect(toPlainText(root)).toBe("before\n    # heading");
    });

    it("protects syntax assembled from separate text elements", async () => {
      const root = await converter.toAst(
        (await item(text("-"), text("-"), text("-"))).mrkdwn
      );
      expect(root.nodes).toEqual(listOf(["p", {}, "---"]));
    });

    it("preserves real formatting around literal syntax", async () => {
      const literal = "# *literal* [x] &lt;";
      const root = await converter.toAst(
        (await item(text(literal, { bold: true }))).mrkdwn
      );
      expect(root.nodes).toEqual(listOf(["p", {}, ["strong", {}, literal]]));
      expect(toPlainText(root)).toBe(literal);
    });

    it.each([
      "*abc*",
      "<b>",
    ])("keeps %j literal when conflicting marks drop inline code", async (literal) => {
      const root = await converter.toAst(
        (
          await item(
            text(literal, { bold: true, code: true }),
            text("x", { italic: true })
          )
        ).mrkdwn
      );
      expect(root.nodes).toEqual(listOf(["p", {}, `${literal}x`]));
      expect(toPlainText(root)).toBe(`${literal}x`);
    });

    it("does not entity-encode punctuation inside inline code", async () => {
      const literal = "--- [x] # > &lt; *literal*";
      const root = await converter.toAst(
        (await item(text(literal, { code: true }))).mrkdwn
      );
      expect(root.nodes).toEqual(listOf(["p", {}, ["code", {}, literal]]));
      expect(toPlainText(root)).toBe(literal);
    });
  });

  describe("inline styles", () => {
    it("nests a style that starts inside another at a space", async () => {
      const { mrkdwn, markdown } = await item(
        text("make ", { bold: true }),
        text("this", { bold: true, italic: true }),
        text(" work", { bold: true })
      );
      expect(mrkdwn).toBe("- *make _this_ work*");
      expect(markdown).toBe("- **make *this* work**");
    });

    it("keeps the shared style when another changes mid-word", async () => {
      const { mrkdwn, markdown } = await item(
        text("foo", { bold: true }),
        text("bar", { bold: true, italic: true })
      );
      expect(mrkdwn).toBe("- *foobar*");
      expect(markdown).toBe("- **foobar**");
    });

    it("drops a style that mrkdwn cannot open mid-word but keeps the text", async () => {
      const { markdown } = await item(
        text("un"),
        text("bold", { bold: true }),
        text("ed")
      );
      expect(markdown).toBe("- unbolded");
    });

    it("closes a style before punctuation", async () => {
      const { markdown } = await item(
        text("Note", { bold: true }),
        text(": read")
      );
      expect(markdown).toBe("- **Note**: read");
    });

    it("keeps whitespace outside markers", async () => {
      const { mrkdwn } = await item(
        text("a "),
        text(" spaced ", { italic: true }),
        text("b")
      );
      expect(mrkdwn).toBe("- a  _spaced_ b");
    });

    it("closes and reopens markers around a line break", async () => {
      const { markdown } = await render(
        event([
          section(text("x")),
          list([section(text("a\nb", { bold: true }))]),
        ])
      );
      expect(markdown).toBe("x\n\n- **a**\n**b**");
    });

    it("renders strike and code, with code innermost", async () => {
      const { mrkdwn, markdown } = await item(
        text("old", { strike: true }),
        text(" "),
        text("run", { bold: true, code: true })
      );
      expect(mrkdwn).toBe("- ~old~ *`run`*");
      expect(markdown).toBe("- ~~old~~ **`run`**");
    });

    it("preserves literal control characters and entity spellings", async () => {
      const literal = "a <b> & c &lt; &#35;";
      const root = await converter.toAst((await item(text(literal))).mrkdwn);
      expect(root.nodes).toEqual(listOf(["p", {}, literal]));
      expect(toPlainText(root)).toBe(literal);
    });
  });

  describe("mentions and links", () => {
    it("keeps special mentions literal inside inline code", async () => {
      const { mrkdwn, markdown } = await item(
        { type: "broadcast", range: "here", style: { code: true } },
        text(" and "),
        { type: "broadcast", range: "channel" }
      );
      expect(mrkdwn).toBe("- `<!here>` and <!channel>");
      expect(markdown).toBe("- `<!here>` and @channel");
    });

    it("applies styles to links", async () => {
      const { markdown } = await item(text("see "), {
        type: "link",
        url: "https://example.com",
        text: "docs",
        style: { bold: true },
      });
      expect(markdown).toBe("- see **[docs](https://example.com)**");
    });

    it("escapes a link label so a > cannot end the token", async () => {
      const { markdown } = await item({
        type: "link",
        url: "https://example.com",
        text: "a|b > c",
      });
      expect(markdown).toBe("- [a|b > c](https://example.com)");
    });

    it("copies user group and channel labels from event.text", () => {
      const body = richTextBody(
        event(
          [
            list([
              section(
                { type: "usergroup", usergroup_id: "S0123" },
                text(" in "),
                { type: "channel", channel_id: "C0456" },
                text(" cc "),
                { type: "user", user_id: "U0789" }
              ),
            ]),
          ],
          { text: "• <!subteam^S0123|@devs> in <#C0456|general> cc <@U0789>" }
        )
      );
      expect(body).toBe(
        "- <!subteam^S0123|@devs> in <#C0456|general> cc <@U0789>"
      );
    });
  });

  describe("rich text block boundaries", () => {
    it("keeps following text out of preceding lists and quotes", async () => {
      const value = event([], {
        blocks: [
          { type: "rich_text", elements: [list([section(text("item"))])] },
          {
            type: "rich_text",
            elements: [{ type: "rich_text_quote", elements: [text("quoted")] }],
          },
          { type: "rich_text", elements: [section(text("after"))] },
        ],
      });
      const root = await converter.toAst((await render(value)).mrkdwn);
      expect(root.nodes).toEqual([
        ...listOf(["p", {}, "item"]),
        ["blockquote", {}, ["p", {}, "quoted"]],
        ["p", {}, "after"],
      ]);
      expect(toPlainText(root)).toBe("item\n\nquoted\n\nafter");
    });
  });

  describe("quotes and code blocks", () => {
    it("renders quotes and preformatted text as their own blocks", async () => {
      const value = event([
        { type: "rich_text_quote", elements: [text("quoted\nlines")] },
        list([section(text("item"))]),
        { type: "rich_text_preformatted", elements: [text("a <b> *c*")] },
        section(text("after")),
      ]);
      const root = await converter.toAst(richTextBody(value) ?? "");
      expect(root.nodes.map(getNodeTag)).toEqual([
        "blockquote",
        "ul",
        "pre",
        "p",
      ]);
      expect(getNodeValue(root.nodes[2])).toBe("a <b> *c*");
    });

    it("trims long runs of trailing newlines in linear time", () => {
      // A preformatted element renders in one pass, so the only work that
      // grows with the input is the newline trimming over the whole body.
      const newlines = "\n".repeat(200_000);
      const value = event([
        list([section(text("a"))]),
        {
          type: "rich_text_preformatted",
          elements: [text(`${newlines}x`)],
        },
      ]);
      const started = performance.now();
      const body = richTextBody(value) ?? "";
      // The quadratic regex this replaces took tens of seconds here.
      expect(performance.now() - started).toBeLessThan(5000);
      expect(body).toBe(`- a\n\n\`\`\`\n${newlines}x\n\`\`\``);
    });
  });
});
