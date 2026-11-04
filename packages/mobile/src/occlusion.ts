/**
 * Which nodes have something else drawn over the point a tap on them lands
 * on. A device reports no hit test with its accessibility tree: XCTest and
 * the simulator bridge derive `hittable` from a node's own frame and the
 * viewport, and agent-device's occlusion pass only knows the system's own
 * chrome kinds (tab bars, sheets, dialogs). So a button scrolled under an
 * app's own sticky footer, or under the soft keyboard, reads as on screen,
 * and a tap at its centre lands on the footer or a key. This reads it from
 * the tree's geometry instead, the way a person sees the screen.
 */

import type { RawNode } from './nodes.ts';
import type { Point, Rect } from './support.ts';

/** What the projection tells this pass about each raw node, by position. */
export interface OcclusionInput {
  readonly raw: readonly RawNode[];
  /** Parent position of every node, as the projection rebuilt the tree. */
  readonly parents: readonly (number | undefined)[];
  /** Platform element type of every node, normalized (`scroll-view`, `navigation-bar`). */
  readonly kinds: readonly string[];
  /** Whether the projection keeps a node: the subtrees it drops (Android's system bars) neither cover nor are covered. */
  readonly kept: (position: number) => boolean;
  /** The soft keyboard's frame the capture measured; undefined with no keyboard or none measured. */
  readonly keyboard: Rect | undefined;
}

/** Bars the platform draws over the content beside them whatever their place in the tree: iOS lists its navigation bar before the content it covers. */
const BAR_KINDS: ReadonlySet<string> = new Set(['navigation-bar', 'tab-bar', 'toolbar', 'bottom-navigation-view']);

/** Platform element types that are the soft keyboard or one of its keys. */
const KEYBOARD_KINDS: ReadonlySet<string> = new Set(['keyboard', 'key']);

/**
 * The share of a scroll view's area past which a node over it is a
 * container, not chrome: a full-screen wrapper an app lays over everything
 * (a toast host, a portal) is listed after the content but lets touches
 * through, while a footer or a header is a band.
 */
const CHROME_MAX_SHARE = 0.5;

/**
 * How far from a scroll view's edge, as a share of its height, a chrome node
 * still hugs that edge. A sticky footer or a tab bar draws its background
 * from its controls to the edge, but the tree lists only the controls: the
 * mobile benchmark's footer pads its Continue button 28 points above the
 * screen's bottom, and a button scrolled into that padding is tapped there
 * and nothing happens. A toast floating mid-screen is farther out.
 */
const EDGE_HUG_SHARE = 0.25;

/**
 * How far past its frame chrome takes a touch, in points: a control's touch
 * area runs past its frame (React Native's `hitSlop`, UIKit's own padding).
 */
const CHROME_CLEARANCE = 8;

/** What is drawn over one node's tap point. */
export interface Cover {
  /** The cover as an error message names it: `the keyboard`, `button "Next"`. */
  readonly by: string;
  /**
   * For sticky chrome, the region of the screen it covers (every chrome node
   * over the tap point together) and the frame of the scroll view it is
   * over, which a scroll moves the node out from under; undefined for the
   * keyboard, which no scroll moves.
   */
  readonly chrome?: { readonly region: Rect; readonly scroll: Rect } | undefined;
}

/** One node drawn over a scroll view, and the region of the screen it covers. */
interface Chrome {
  readonly position: number;
  /** Its frame grown by `CHROME_CLEARANCE`. */
  readonly frame: Rect;
  /** `frame`, reaching the edge of the scroll view the node hugs. */
  readonly region: Rect;
}

/** Whether a platform element type scrolls its content: UIKit and Android scroll views, lists, grids, and tables. */
function isScrollKind(kind: string): boolean {
  return (
    kind.endsWith('scroll-view') ||
    kind.endsWith('recycler-view') ||
    kind.endsWith('list-view') ||
    kind.endsWith('grid-view') ||
    kind === 'collection-view' ||
    kind === 'table'
  );
}

/**
 * The node each covered node's tap point lies under, by position: named for
 * an error message and, for chrome, where it lies over its scroll view. A tap lands on the centre of a node's frame, and two
 * things cover it there:
 *
 * - Chrome over a scroll view: a node outside the scroll view the content
 *   sits in (its nearest one), listed after it or a bar, that spans less
 *   than half the scroll view, and whose frame holds the tap point, grown by
 *   `CHROME_CLEARANCE` and, for chrome that hugs an edge of the scroll view,
 *   reaching that edge (`EDGE_HUG_SHARE`). Drawing order follows the tree on
 *   both platforms, so a sticky footer an app lays over its list is listed
 *   after the list. A node directly in a scroll view around that one is its
 *   scroll indicator, which takes no touches, and is never chrome; Android
 *   lists a React Native screen, footer and all, inside an outer scroll
 *   view. Only scrolled content is judged: it is what moves under chrome,
 *   and scrolling is what brings it back out. Overlapping nodes of one
 *   layout (a badge on a card) are not told apart from a stack, so content
 *   is never covered by content.
 * - The soft keyboard: every node of the app whose tap point lies inside the
 *   keyboard's frame, except the keyboard's own keys and the bars it hosts.
 *
 * What the tree leaves out covers only where it is padding around listed
 * chrome: a view with no accessibility element and nothing listed in it,
 * such as a decorative banner, covers nothing here.
 */
export function coveredNodes(input: OcclusionInput): ReadonlyMap<number, Cover> {
  const { raw, parents, kinds, kept, keyboard } = input;
  const covered = new Map<number, Cover>();
  // Parents precede their children, so one pass top-down finds every node's
  // nearest scroll view and whether it belongs to the keyboard.
  const scrollOf: (number | undefined)[] = [];
  const inKeyboard: boolean[] = [];
  for (let position = 0; position < raw.length; position += 1) {
    const parent = parents[position];
    scrollOf[position] = parent === undefined ? undefined : isScrollKind(kinds[parent] ?? '') ? parent : scrollOf[parent];
    inKeyboard[position] =
      raw[position]?.keyboardOwned === true ||
      KEYBOARD_KINDS.has(kinds[position] ?? '') ||
      (parent !== undefined && inKeyboard[parent] === true);
  }
  const chrome = new Map<number, readonly Chrome[]>();
  const chromeOver = (scroll: number): readonly Chrome[] => {
    const cached = chrome.get(scroll);
    if (cached !== undefined) return cached;
    const found = chromeCandidates(input, scroll, inKeyboard);
    chrome.set(scroll, found);
    return found;
  };
  for (let position = 0; position < raw.length; position += 1) {
    if (!kept(position)) continue;
    const rect = positive(raw[position]?.rect);
    if (rect === undefined) continue;
    const point = centre(rect);
    if (keyboard !== undefined && !inKeyboard[position] && !encloses(rect, keyboard) && contains(keyboard, point)) {
      covered.set(position, { by: 'the keyboard' });
      continue;
    }
    const scroll = scrollOf[position];
    if (scroll === undefined) continue;
    // Name the chrome nearest the point among those whose region holds it: the
    // one it is on, else the one whose padding it is in. A scroll has to clear
    // all of them, so the region is their union.
    let cover: Chrome | undefined;
    let region: Rect | undefined;
    for (const candidate of chromeOver(scroll)) {
      if (!contains(candidate.region, point)) continue;
      region = region === undefined ? candidate.region : union(region, candidate.region);
      if (cover === undefined || distance(candidate.frame, point) < distance(cover.frame, point)) cover = candidate;
    }
    if (cover !== undefined && region !== undefined) {
      covered.set(position, {
        by: describeCover(raw[cover.position]!, kinds[cover.position] ?? ''),
        chrome: { region, scroll: raw[scroll]!.rect! },
      });
    }
  }
  return covered;
}

/**
 * The nodes drawn over the scroll view at `scroll`: outside it, not above it
 * in the tree, no scroll indicator of a scroll view around it, after it or a
 * bar, and a band rather than a wrapper.
 */
function chromeCandidates(input: OcclusionInput, scroll: number, inKeyboard: readonly boolean[]): Chrome[] {
  const { raw, parents, kinds, kept } = input;
  const area = positive(raw[scroll]?.rect);
  if (area === undefined) return [];
  const ancestors = new Set<number>();
  for (let current = parents[scroll]; current !== undefined; current = parents[current]) ancestors.add(current);
  const inside = (position: number): boolean => {
    for (let current = parents[position]; current !== undefined; current = parents[current]) {
      if (current === scroll) return true;
    }
    return false;
  };
  const found: Chrome[] = [];
  for (let position = 0; position < raw.length; position += 1) {
    const node = raw[position]!;
    const rect = positive(node.rect);
    if (rect === undefined || position === scroll || ancestors.has(position) || inside(position)) continue;
    const parent = parents[position];
    if (parent !== undefined && ancestors.has(parent) && isScrollKind(kinds[parent] ?? '')) continue;
    if (!kept(position) || inKeyboard[position] || node.visibleToUser === false) continue;
    if (position < scroll && !BAR_KINDS.has(kinds[position] ?? '')) continue;
    if (rect.width * rect.height >= area.width * area.height * CHROME_MAX_SHARE || !intersects(rect, area)) continue;
    found.push({ position, frame: grow(rect, CHROME_CLEARANCE), region: chromeRegion(rect, area) });
  }
  return found;
}

/** What one chrome node covers of the screen: its frame grown by `CHROME_CLEARANCE`, reaching the edge of the scroll view it hugs. */
function chromeRegion(rect: Rect, scroll: Rect): Rect {
  let top = rect.y - CHROME_CLEARANCE;
  let bottom = rect.y + rect.height + CHROME_CLEARANCE;
  const toTop = rect.y - scroll.y;
  const toBottom = scroll.y + scroll.height - (rect.y + rect.height);
  const hug = scroll.height * EDGE_HUG_SHARE;
  if (toBottom <= toTop && toBottom <= hug) bottom = Math.max(bottom, scroll.y + scroll.height);
  else if (toTop < toBottom && toTop <= hug) top = Math.min(top, scroll.y);
  return { x: rect.x - CHROME_CLEARANCE, y: top, width: rect.width + CHROME_CLEARANCE * 2, height: bottom - top };
}

/** A covering node as an error message names it: its kind and its label, identifier, or nothing. */
function describeCover(node: RawNode, kind: string): string {
  const name = node.label?.trim() || node.identifier?.trim();
  return name === undefined || name === '' ? `a ${kind || 'node'}` : `${kind || 'node'} "${name.slice(0, 60)}"`;
}

/** How far a point lies outside a rect; 0 inside it. */
function distance(rect: Rect, point: Point): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** A rect grown by `margin` on every side. */
function grow(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

/** The rect when it has an area; undefined otherwise. */
function positive(rect: Rect | undefined): Rect | undefined {
  return rect !== undefined && rect.width > 0 && rect.height > 0 ? rect : undefined;
}

function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Whether a point lies inside a rect, edges included. */
function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Whether `outer` holds all of `inner`: a window or a screen-wide container is never under the keyboard it holds. */
function encloses(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
}

/** The smallest rect holding both. */
function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
