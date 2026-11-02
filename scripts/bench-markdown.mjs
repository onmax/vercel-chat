// Usage: node scripts/bench-markdown.mjs <repo-root> <label>
// Build chat and the slack, teams, discord, and telegram adapters in <repo-root> first.
import { pathToFileURL } from "node:url";

const [root, label] = process.argv.slice(2);
const load = (p) =>
  import(pathToFileURL(`${root}/packages/${p}/dist/index.js`).href);
const chat = await load("chat");
const { SlackFormatConverter } = await load("adapter-slack");
const { TeamsFormatConverter } = await load("adapter-teams");
const { DiscordFormatConverter } = await load("adapter-discord");
const { TelegramFormatConverter } = await load("adapter-telegram");

const short =
  "Hey **there**, can you check [the deploy](https://vercel.com/x) when you get a sec? `pnpm build` failed again.";
const medium = `## Deploy summary

The build failed on **step 3**. Here's what I found:

1. The \`postinstall\` script exits with code 1
2. It only happens on Node 24
   - Node 22 works
   - Node 20 works
3. The lockfile looks fine

\`\`\`ts
export function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  return fn().catch((error) => (attempts > 1 ? retry(fn, attempts - 1) : Promise.reject(error)));
}
\`\`\`

| Region | Status | Latency |
| --- | --- | --- |
| iad1 | ok | 42ms |
| fra1 | failing | - |
| hnd1 | ok | 180ms |

> Note: _fra1_ has been ~~flaky~~ down since this morning.

See https://vercel.com/docs/deployments for details, or ping the on-call.
`;
const long = Array.from({ length: 7 }, () => medium).join("\n\n");
const slackMrkdwn =
  "Hey <@U123ABC>, *deploy* failed in <#C456|ops>. See <https://vercel.com/x|the logs> and _retry_ ~maybe~ later.\n> quoted line\n```\ncode block\n```";

const slack = new SlackFormatConverter(),
  teams = new TeamsFormatConverter(),
  discord = new DiscordFormatConverter(),
  telegram = new TelegramFormatConverter();
const ast = {
  short: await chat.parseMarkdown(short),
  medium: await chat.parseMarkdown(medium),
  long: await chat.parseMarkdown(long),
};

function streamOnce() {
  const r = new chat.StreamingMarkdownRenderer();
  for (let i = 0; i < medium.length; i += 12) {
    r.push(medium.slice(i, i + 12));
    r.render();
  }
  r.finish();
}

const cases = [];
for (const [size, md] of [
  ["short", short],
  ["medium", medium],
  ["long", long],
]) {
  cases.push([`parseMarkdown ${size}`, () => chat.parseMarkdown(md)]);
  cases.push([
    `stringifyMarkdown ${size}`,
    () => chat.stringifyMarkdown(ast[size]),
  ]);
  cases.push([`teams fromMarkdown ${size}`, () => teams.fromMarkdown(md)]);
  cases.push([`discord fromMarkdown ${size}`, () => discord.fromMarkdown(md)]);
  cases.push([
    `telegram fromMarkdown ${size}`,
    () => telegram.fromMarkdown(md),
  ]);
  cases.push([`teams parseIncoming ${size}`, () => teams.parseIncoming(md)]);
}
cases.push([
  "slack parseIncoming mrkdwn",
  () => slack.parseIncoming(slackMrkdwn),
]);
cases.push(["streaming render (medium, 12-char chunks)", () => streamOnce()]);

async function measure(fn) {
  const runFor = async (ms) => {
    let n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      await fn();
      n++;
    }
    return n;
  };
  await runFor(300);
  const rounds = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const n = await runFor(400);
    rounds.push(((performance.now() - t) * 1000) / n);
  }
  rounds.sort((a, b) => a - b);
  return rounds[2]; // median µs/op
}
const out = {};
for (const [name, fn] of cases) {
  out[name] = await measure(fn);
}
console.log(JSON.stringify({ label, node: process.version, results: out }));
