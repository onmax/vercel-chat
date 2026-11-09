/**
 * Split long Telegram messages into ordered parts that each fit a length
 * budget without cutting through formatting.
 *
 * Splitting works on the markdown AST rather than the rendered string, so
 * every part is rendered from a complete subtree and its entities stay
 * balanced in both MarkdownV2 and rich-message markdown.
 */

import {
  type Content,
  getNodeAttributes,
  getNodeChildren,
  getNodeTag,
  isTableNode,
  type Root,
  root as rootOf,
} from "chat";

type Element = [string, Record<string, unknown>, ...Content[]];
type Fits = (root: Root) => boolean | Promise<boolean>;
/**
 * Wrap a piece of a node in copies of its ancestors. `first` is set while
 * sizing the first piece the node emits, which shares its part with the
 * siblings packed before it at each ancestor level.
 */
type Wrap = (node: Content, first: boolean) => Root;
type Build = (items: Content[], firstIndex: number) => Content;

interface BreakRules {
  /** Share of the budget a separator must keep to be used. */
  minRatio: number;
  /** Separators to break at, in order of preference. */
  separators: readonly string[];
}

// The document, as an element so it splits like any other container.
const ROOT_TAG = "#root";
// Elements that render something without children.
const LEAF_TAGS = new Set(["br", "hr", "img", "th", "td"]);

// Text only breaks at a separator that keeps at least half the budget;
// otherwise a far-back newline would produce a tiny part.
const TEXT_BREAKS: BreakRules = {
  minRatio: 0.5,
  separators: ["\n\n", "\n", " "],
};
// Code only breaks between lines, wherever the last fitting newline is. The
// part boundary stands in for the dropped newline.
const CODE_BREAKS: BreakRules = { minRatio: 0, separators: ["\n"] };
const EMOJI_PLACEHOLDER = /\{\{emoji:[a-z0-9_]+\}\}/gi;

function isNode(node: Content | null): node is Content {
  return node !== null;
}

function toRoot(node: Content): Root {
  return rootOf(getNodeChildren(node));
}

/**
 * Split `root` into ordered roots that each satisfy `fits`.
 *
 * Top-level blocks are packed greedily. A block that does not fit on its own
 * is split by its children, recursively, and its first piece shares a part
 * with the blocks packed before it. Text values are split at paragraph, line,
 * or word boundaries, and code at line boundaries. A part is always wrapped in
 * copies of its ancestors, so a split bold run or code block is reopened in
 * the next part. A node that cannot be split further and still does not fit
 * (for example an image with a huge URL) is emitted on its own.
 */
export async function splitMarkdownAst(
  root: Root,
  fits: Fits
): Promise<Root[]> {
  if (await fits(root)) {
    return [root];
  }
  const element: Element = [
    ROOT_TAG,
    {},
    ...root.nodes.map(withoutEmptyContainers).filter(isNode),
  ];
  const parts = (await splitChildren(element, toRoot, fits, false)) ?? [
    element,
  ];
  const trimmed: Root[] = [];
  for (const part of parts) {
    const start = trimEdgeText(part, "start");
    const both = start && trimEdgeText(start, "end");
    if (both && getNodeChildren(both).length > 0) {
      trimmed.push(toRoot(both));
    }
  }
  return trimmed;
}

/**
 * Copy `node` without containers that have nothing in them, such as a
 * blockquote that only held a link definition. They would render a stray `>`
 * or list marker. Subtrees without empty containers are reused.
 */
function withoutEmptyContainers(node: Content): Content | null {
  const tag = getNodeTag(node);
  if (tag === undefined || LEAF_TAGS.has(tag)) {
    return node;
  }
  const children = getNodeChildren(node);
  const kept = children.map(withoutEmptyContainers).filter(isNode);
  if (kept.length === 0) {
    return null;
  }
  const unchanged = kept.every((child, index) => child === children[index]);
  return unchanged && kept.length === children.length
    ? node
    : [tag, getNodeAttributes(node), ...kept];
}

/**
 * Split a plain string into ordered parts that each satisfy `fits`, breaking
 * at paragraph, line, or word boundaries when possible.
 */
export function splitText(
  value: string,
  fits: (value: string) => boolean
): Promise<string[]> {
  return splitValue(value, (part) => fits(part), TEXT_BREAKS);
}

/**
 * Trim whitespace from the text at the start or end of `node`, copying the
 * path to it. A split between inline nodes can leave a part starting or
 * ending with a space. Trimming only shortens a part, so it still fits.
 *
 * Returns `null` when trimming empties the node. An empty paragraph, list
 * item, or blockquote renders a stray marker, so the parent drops it and
 * trims the next edge node. Table cells are kept empty instead, so a row
 * keeps its columns.
 */
function trimEdgeText(node: Content, edge: "start" | "end"): Content | null {
  if (typeof node === "string") {
    const value = edge === "start" ? node.trimStart() : node.trimEnd();
    return value || null;
  }
  const tag = getNodeTag(node) ?? "";
  const children = getNodeChildren(node);
  // Whitespace in code is content.
  if (children.length === 0 || tag === "pre" || tag === "code") {
    return node;
  }
  let changed = false;
  while (children.length > 0) {
    const index = edge === "start" ? 0 : children.length - 1;
    const child = children[index] as Content;
    const trimmed = trimEdgeText(child, edge);
    if (trimmed === child) {
      break;
    }
    changed = true;
    if (trimmed) {
      children[index] = trimmed;
      break;
    }
    children.splice(index, 1);
  }
  if (!changed) {
    return node;
  }
  if (children.length === 0 && ![ROOT_TAG, "th", "td"].includes(tag)) {
    return null;
  }
  return [tag, getNodeAttributes(node), ...children];
}

/**
 * Split `value` into parts that satisfy `fits`. `first` is set while sizing
 * the first part.
 */
async function splitValue(
  value: string,
  fits: (value: string, first: boolean) => boolean | Promise<boolean>,
  rules: BreakRules
): Promise<string[]> {
  const parts: string[] = [];
  let rest = value;

  while (rest.length > 0) {
    const first = parts.length === 0;
    if (await fits(rest, first)) {
      parts.push(rest);
      break;
    }

    const max = await largestFitting(rest.length - 1, (length) =>
      fits(rest.slice(0, length), first)
    );
    if (max === 0) {
      // Not even one character fits inside the surrounding markup.
      parts.push(rest);
      break;
    }

    const { end, next } = findBreak(rest, max, rules);
    if (end === 0) {
      // What fits would cut the leading placeholder or surrogate pair.
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, end));
    rest = rest.slice(next);
  }

  return parts;
}

/**
 * Largest `n` in `[0, max]` for which `test(n)` holds, assuming `test` is
 * monotonic and `test(0)` holds. Gallops from 1 so each probe stays close to
 * the size of one part instead of the whole remaining message.
 */
async function largestFitting(
  max: number,
  test: (n: number) => boolean | Promise<boolean>
): Promise<number> {
  if (max < 1 || !(await test(1))) {
    return 0;
  }
  let low = 1;
  let high = 2;
  while (high <= max && (await test(high))) {
    low = high;
    high *= 2;
  }
  high = Math.min(high, max + 1);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await test(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

function findBreak(
  value: string,
  max: number,
  rules: BreakRules
): { end: number; next: number } {
  const minimum = Math.floor(max * rules.minRatio);
  for (const separator of rules.separators) {
    const index = value.lastIndexOf(separator, max);
    if (index > 0 && index >= minimum) {
      return { end: index, next: index + separator.length };
    }
  }
  const end = hardBreak(value, max);
  return { end, next: end };
}

/**
 * Break at `max`, moved back so the break separates neither a surrogate pair
 * nor an emoji placeholder. Placeholders are converted after rendering, so a
 * cut one would reach the user as literal text. Returns 0 when the value
 * starts with one that doesn't fit.
 */
function hardBreak(value: string, max: number): number {
  for (const match of value.matchAll(EMOJI_PLACEHOLDER)) {
    if (match.index >= max) {
      break;
    }
    if (max < match.index + match[0].length) {
      return match.index;
    }
  }
  const code = value.charCodeAt(max - 1);
  return code >= 0xd8_00 && code <= 0xdb_ff ? max - 1 : max;
}

async function splitNode(
  node: Content,
  wrap: Wrap,
  fits: Fits,
  inCode: boolean
): Promise<Content[] | null> {
  if (typeof node === "string") {
    if (!node) {
      return [node];
    }
    return splitValue(
      node,
      (value, first) => fits(wrap(value, first)),
      inCode ? CODE_BREAKS : TEXT_BREAKS
    );
  }
  if (rowsOf(node).length > 0) {
    return splitChildren(
      node as Element,
      wrap,
      fits,
      inCode || getNodeTag(node) === "pre"
    );
  }
  return [node];
}

/**
 * The children `splitChildren` packs: a table's rows, so the header row can
 * be repeated, and every other element's children.
 */
function rowsOf(node: Content): Content[] {
  if (isTableNode(node)) {
    return getNodeChildren(node).flatMap(getNodeChildren);
  }
  return getNodeChildren(node);
}

function withChildren(
  node: Element,
  children: Content[],
  firstIndex: number
): Content {
  const [tag, attributes] = node;
  if (isTableNode(node)) {
    const [header, ...body] = children;
    return [
      tag,
      attributes,
      ["thead", {}, ...(header ? [header] : [])],
      ["tbody", {}, ...body],
    ];
  }
  // Keep ordered list numbering continuous across parts.
  if (tag === "ol") {
    const start = Number(attributes.start ?? 1) + firstIndex;
    return [tag, { ...attributes, start: String(start) }, ...children];
  }
  return [tag, attributes, ...children];
}

/**
 * Returns how to copy `node` with the children starting at `firstIndex`, and
 * the table header row that every later part repeats, if any.
 */
async function pieceBuilder(
  node: Element,
  wrap: Wrap,
  fits: Fits
): Promise<{ build: Build; header: Content | undefined }> {
  const children = rowsOf(node);

  // Repeat a table's header row in every part, so later parts don't promote
  // their first body row to the header. Skip it when the header can't share a
  // part with any whole body row, since repeating it would split every row
  // apart.
  const [firstChild, ...bodyRows] = children;
  let header: Content | undefined;
  if (isTableNode(node) && firstChild) {
    for (const row of bodyRows) {
      if (await fits(wrap(withChildren(node, [firstChild, row], 0), false))) {
        header = firstChild;
        break;
      }
    }
  }

  const build: Build = (items, firstIndex) => {
    if (header && firstIndex > 0) {
      return withChildren(node, [header, ...items], firstIndex);
    }
    if (getNodeTag(node) === "tr") {
      // Pad part of a split row with empty cells so each cell stays in its
      // column.
      const cell = (): Content => [getNodeTag(children[0]) ?? "td", {}];
      const after = children.length - firstIndex - items.length;
      return withChildren(
        node,
        [
          ...Array.from({ length: firstIndex }, cell),
          ...items,
          ...Array.from({ length: after }, cell),
        ],
        firstIndex
      );
    }
    return withChildren(node, items, firstIndex);
  };

  return { build, header };
}

/**
 * Split `node` into copies that each hold a run of its children, packing them
 * greedily. A child that does not fit on its own is split, and its first
 * piece is sized together with the children packed before it.
 *
 * Returns `null` when the first piece of `node` is being sized beside an
 * ancestor's packed siblings and its first child only fits in a part of its
 * own. The ancestor then sends those siblings alone instead of splitting a
 * child that didn't need it.
 */
async function splitChildren(
  node: Element,
  wrap: Wrap,
  fits: Fits,
  inCode: boolean
): Promise<Content[] | null> {
  const children = rowsOf(node);
  const { build, header } = await pieceBuilder(node, wrap, fits);
  const pieces: Content[] = [];
  const fitsAs = (items: Content[], firstIndex: number) =>
    fits(wrap(build(items, firstIndex), pieces.length === 0));

  // Children packed into the piece being built, starting at `batchStart`. The
  // first item may be the last piece of a split child.
  let batch: Content[] = [];
  let batchStart = 0;
  let index = 0;

  while (index < children.length) {
    const start = batch.length > 0 ? batchStart : index;
    const taken = await largestFitting(children.length - index, (n) =>
      fitsAs([...batch, ...children.slice(index, index + n)], start)
    );
    batch = [...batch, ...children.slice(index, index + taken)];
    batchStart = start;
    index += taken;

    const child = children[index];
    if (child === undefined) {
      break;
    }

    if (await fits(wrap(build([child], index), false))) {
      // An empty batch, or a lone repeated table header, means only the
      // ancestors' packed siblings keep the child out of this part.
      if (batch.length === 0 || (header && batch.length === 1 && start === 0)) {
        return null;
      }
      pieces.push(build(batch, batchStart));
      batch = [];
      continue;
    }

    const childIndex = index;
    const splitChild = (leading: Content[], leadingStart: number) => {
      const first = pieces.length === 0;
      return splitNode(
        child,
        (piece, childFirst) =>
          childFirst
            ? wrap(build([...leading, piece], leadingStart), first)
            : wrap(build([piece], childIndex), false),
        fits,
        inCode
      );
    };

    let childPieces = await splitChild(batch, start);
    if (batch.length > 0) {
      const head = childPieces?.[0];
      if (
        !(head !== undefined && (await fitsAs([...batch, head], batchStart)))
      ) {
        // Nothing of the child fits beside the batch, so send the batch alone.
        // A lone table header is dropped instead, since `build` repeats it
        // before every later piece.
        if (!(header && batch.length === 1 && batchStart === 0)) {
          pieces.push(build(batch, batchStart));
        }
        batch = [];
        childPieces = await splitChild([], childIndex);
      }
    }
    if (!childPieces) {
      return null;
    }

    const [head, ...rest] = childPieces as [Content, ...Content[]];
    const headStart = batch.length > 0 ? batchStart : childIndex;
    const last = rest.pop();
    if (last !== undefined) {
      pieces.push(build([...batch, head], headStart));
      for (const piece of rest) {
        pieces.push(build([piece], childIndex));
      }
      batch = [last];
      batchStart = childIndex;
    } else {
      batch = [...batch, head];
      batchStart = headStart;
    }
    index += 1;
  }

  if (batch.length > 0) {
    pieces.push(build(batch, batchStart));
  }
  return pieces;
}
