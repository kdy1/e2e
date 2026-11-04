/**
 * Tap points covered by something drawn over them: sticky chrome over a
 * scroll view and the soft keyboard. A press on a covered node waits for it
 * to clear and names its cover when it does not; the node's visibility stays
 * what the platform reported.
 */

import { describe, expect, it } from 'vitest';
import { projectSnapshot, type RawNode } from '../../src/nodes.ts';
import type { Rect } from '../../src/support.ts';

function project(nodes: readonly RawNode[], keyboard?: Rect) {
  let counter = 0;
  return projectSnapshot(nodes, {
    mintId: () => {
      counter += 1;
      return `n${counter}`;
    },
    viewport: { width: 402, height: 874 },
    keyboard,
  });
}

/** What covers each node's tap point, by test id or label; undefined for a node nothing covers. */
function covers(nodes: readonly RawNode[], keyboard?: Rect): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const entry of project(nodes, keyboard).index) {
    out[entry.raw.identifier ?? entry.raw.label ?? entry.kind] = entry.coveredBy?.by;
  }
  return out;
}

let next = 0;
function node(fields: Omit<RawNode, 'index' | 'ref'>): RawNode {
  next += 1;
  return { index: next - 1, ref: `@e${next}`, ...fields };
}

/**
 * The mobile benchmark's Sticky Chrome Target as the iOS simulator bridge
 * reads it once a scroll leaves "Accept terms" at `acceptY` (a live capture,
 * trimmed): the app lays its footer, an error text over the Continue decoy,
 * over the bottom of the scroll view, and the bridge clips a frame at the
 * screen's edge.
 */
function stickyChrome(acceptY: number): RawNode[] {
  next = 0;
  return [
    node({ type: 'Application', label: 'e2e Benchmark', rect: { x: 0, y: 0, width: 402, height: 874 } }),
    node({ parentIndex: 0, type: 'NavigationBar', identifier: 'Sticky Chrome Target', rect: { x: 0, y: 62, width: 402, height: 54 } }),
    node({ parentIndex: 0, type: 'ScrollView', rect: { x: 0, y: 116, width: 402, height: 758 } }),
    node({ parentIndex: 2, type: 'StaticText', label: 'Section 14', rect: { x: 16, y: acceptY - 94, width: 370, height: 18 } }),
    node({ parentIndex: 2, type: 'Other', label: 'Accept terms', identifier: 'accept-terms', rect: { x: 16, y: acceptY, width: 370, height: Math.min(46, 874 - acceptY) } }),
    node({ parentIndex: 2, type: 'Other', label: 'Vertical scroll bar, 3 pages', value: '78%', rect: { x: 369, y: 144, width: 30, height: 668 } }),
    node({ parentIndex: 2, type: 'Other', label: 'Horizontal scroll bar, 1 page', value: '0%', rect: { x: 62, y: 841, width: 278, height: 30 } }),
    node({ parentIndex: 0, type: 'StaticText', label: 'Accept the terms at the bottom first', rect: { x: 16, y: 776.33, width: 370, height: 15.67 } }),
    node({ parentIndex: 0, type: 'Other', label: 'Continue', identifier: 'continue-button', rect: { x: 16, y: 800, width: 370, height: 46 } }),
  ];
}

describe('sticky chrome over a scroll view', () => {
  it('finds a control scrolled under a sticky footer covered, naming the footer control its tap would hit', () => {
    const read = covers(stickyChrome(782));
    expect(read['accept-terms']).toEqual('other "Continue"');
    // The footer itself and the bar above are not covered.
    expect(read['continue-button']).toBeUndefined();
    expect(read['Accept the terms at the bottom first']).toBeUndefined();
    expect(read['Sticky Chrome Target']).toBeUndefined();
  });

  it('finds one scrolled into the footer padding below its last control covered, where the failing runs left it', () => {
    // Pressed at y 855 and 872 on a loaded simulator: the footer took the tap and the terms stayed unaccepted.
    expect(covers(stickyChrome(836))['accept-terms']).toEqual('other "Continue"');
    expect(covers(stickyChrome(869))['accept-terms']).toEqual('other "Continue"');
  });

  it('leaves a covered node visible: the cover is for a press to wait on, not for visibility', () => {
    const accept = project(stickyChrome(836)).index.find((entry) => entry.raw.identifier === 'accept-terms');
    expect(accept?.coveredBy?.by).toBe('other "Continue"');
    expect(accept?.node.states?.hidden).toBeUndefined();
  });

  it('gives a scroll the whole footer to clear, every chrome node over the tap point together, and the scroll view it is over', () => {
    const accept = project(stickyChrome(782)).index.find((entry) => entry.raw.identifier === 'accept-terms');
    // Continue's region starts at 792 and the footer text's at 768.33; both reach the screen's bottom.
    expect(accept?.coveredBy?.chrome).toEqual({
      region: { x: 8, y: 768.33, width: 386, height: 874 - 768.33 },
      scroll: { x: 0, y: 116, width: 402, height: 758 },
    });
  });

  it('gives the keyboard no scroll view: no scroll moves a node out from under it', () => {
    expect(project([
      { index: 0, ref: '@e1', type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } },
      { index: 1, ref: '@e2', parentIndex: 0, type: 'TextField', identifier: 'field', rect: { x: 16, y: 600, width: 370, height: 44 } },
    ], { x: 0, y: 548, width: 402, height: 326 }).index[1]?.coveredBy).toEqual({ by: 'the keyboard' });
  });

  it('finds it clear once it is scrolled out, as the passing runs leave it at y 688 and 730', () => {
    expect(covers(stickyChrome(688))['accept-terms']).toBeUndefined();
    expect(covers(stickyChrome(730))['accept-terms']).toBeUndefined();
  });

  it('finds one covered whose tap point is under the footer text, not only its button', () => {
    expect(covers(stickyChrome(760))['accept-terms']).toEqual('static-text "Accept the terms at the bottom first"');
  });

  it('never lets a scroll indicator or other content of the same scroll view cover content', () => {
    next = 0;
    const nodes = [
      node({ type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 0, type: 'ScrollView', rect: { x: 0, y: 116, width: 402, height: 758 } }),
      node({ parentIndex: 1, type: 'Switch', label: 'Trailing', identifier: 'trailing', rect: { x: 350, y: 400, width: 40, height: 30 } }),
      node({ parentIndex: 1, type: 'Other', label: 'Card', identifier: 'card', rect: { x: 16, y: 500, width: 370, height: 100 } }),
      // A badge drawn over the card's middle, listed after it inside the same scroll view.
      node({ parentIndex: 1, type: 'StaticText', label: 'New', identifier: 'badge', rect: { x: 150, y: 520, width: 100, height: 60 } }),
      node({ parentIndex: 1, type: 'Other', label: 'Vertical scroll bar, 3 pages', rect: { x: 369, y: 144, width: 30, height: 668 } }),
    ];
    const read = covers(nodes);
    expect(read.trailing).toBeUndefined();
    expect(read.card).toBeUndefined();
  });

  it('never lets a scroll indicator of an enclosing scroll view cover a carousel inside it', () => {
    next = 0;
    const nodes = [
      node({ type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 0, type: 'ScrollView', rect: { x: 0, y: 116, width: 402, height: 758 } }),
      node({ parentIndex: 1, type: 'ScrollView', rect: { x: 0, y: 300, width: 402, height: 120 } }),
      node({ parentIndex: 2, type: 'Button', label: 'Last card', identifier: 'last', rect: { x: 360, y: 320, width: 40, height: 80 } }),
      node({ parentIndex: 1, type: 'Other', label: 'Vertical scroll bar, 3 pages', rect: { x: 369, y: 144, width: 30, height: 668 } }),
    ];
    expect(covers(nodes).last).toBeUndefined();
  });

  it('lets no screen-wide wrapper listed after the content cover it, only a band', () => {
    next = 0;
    const nodes = [
      node({ type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 0, type: 'ScrollView', rect: { x: 0, y: 116, width: 402, height: 758 } }),
      node({ parentIndex: 1, type: 'Button', label: 'Row', identifier: 'row', rect: { x: 16, y: 400, width: 370, height: 44 } }),
      // A toast host laid over the whole screen: touches go through it.
      node({ parentIndex: 0, type: 'Other', label: 'Toast host', rect: { x: 0, y: 62, width: 402, height: 812 } }),
    ];
    expect(covers(nodes).row).toBeUndefined();
  });

  it('judges only scrolled content: nodes of a fixed layout are never covered by a later one', () => {
    next = 0;
    const nodes = [
      node({ type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 0, type: 'Image', label: 'Hero', identifier: 'hero', rect: { x: 0, y: 100, width: 402, height: 300 } }),
      node({ parentIndex: 0, type: 'StaticText', label: 'Title over the hero', rect: { x: 16, y: 230, width: 370, height: 40 } }),
    ];
    expect(covers(nodes).hero).toBeUndefined();
  });

  it('finds content scrolled under a navigation bar the platform lists before it covered', () => {
    next = 0;
    const nodes = [
      node({ type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 0, type: 'NavigationBar', identifier: 'Inbox', rect: { x: 0, y: 62, width: 402, height: 96 } }),
      node({ parentIndex: 0, type: 'ScrollView', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 2, type: 'Cell', label: 'Under the bar', identifier: 'under', rect: { x: 0, y: 90, width: 402, height: 44 } }),
      node({ parentIndex: 2, type: 'Cell', label: 'Below the bar', identifier: 'below', rect: { x: 0, y: 200, width: 402, height: 44 } }),
    ];
    const read = covers(nodes);
    expect(read.under).toEqual('navigation-bar "Inbox"');
    expect(read.below).toBeUndefined();
  });

  it('finds an Android footer laid over a scroll view inside the outer scroll view React Native wraps the screen in', () => {
    next = 0;
    const nodes = [
      node({ type: 'android.widget.FrameLayout', rect: { x: 0, y: 0, width: 1080, height: 2400 } }),
      node({ parentIndex: 0, type: 'android.widget.ScrollView', rect: { x: 0, y: 0, width: 1080, height: 2400 } }),
      node({ parentIndex: 1, type: 'android.view.ViewGroup', rect: { x: 0, y: 283, width: 1080, height: 2117 } }),
      node({ parentIndex: 2, type: 'android.widget.ScrollView', rect: { x: 0, y: 283, width: 1080, height: 2117 } }),
      node({ parentIndex: 3, type: 'android.view.ViewGroup', identifier: 'accept-terms', label: 'Accept terms', rect: { x: 42, y: 2220, width: 996, height: 120 } }),
      node({ parentIndex: 2, type: 'android.view.ViewGroup', identifier: 'continue-button', label: 'Continue', rect: { x: 42, y: 2199, width: 996, height: 128 } }),
    ];
    const read = covers(nodes);
    expect(read['accept-terms']).toEqual('view-group "Continue"');
    expect(read['continue-button']).toBeUndefined();
  });
});

describe('the soft keyboard', () => {
  /**
   * A form in a scroll view with a Back/Next footer the app raises above the
   * keyboard (tester-army/e2e#1324): the focused field stays clear, the next
   * one sits under the raised footer, and the last one under the keyboard.
   */
  function raisedFooterForm(): RawNode[] {
    next = 0;
    return [
      node({ type: 'Application', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ parentIndex: 0, type: 'ScrollView', rect: { x: 0, y: 116, width: 402, height: 758 } }),
      node({ parentIndex: 1, type: 'TextField', label: 'Product name', identifier: 'product-name', focused: true, rect: { x: 16, y: 300, width: 370, height: 44 } }),
      node({ parentIndex: 1, type: 'TextField', label: 'Brand', identifier: 'brand', rect: { x: 16, y: 488, width: 370, height: 44 } }),
      node({ parentIndex: 1, type: 'TextField', label: 'Size', identifier: 'size', rect: { x: 16, y: 640, width: 370, height: 44 } }),
      node({ parentIndex: 0, type: 'Button', label: 'Back', identifier: 'back', rect: { x: 16, y: 492, width: 160, height: 44 } }),
      node({ parentIndex: 0, type: 'Button', label: 'Next', identifier: 'next', rect: { x: 186, y: 492, width: 200, height: 44 } }),
      node({ parentIndex: 0, type: 'Keyboard', rect: { x: 0, y: 548, width: 402, height: 326 } }),
      node({ parentIndex: 7, type: 'Key', label: 'q', rect: { x: 4, y: 560, width: 36, height: 44 } }),
      node({ parentIndex: 0, type: 'Other', label: 'Toolbar Done', keyboardOwned: true, rect: { x: 300, y: 560, width: 80, height: 40 } }),
    ];
  }
  const keyboard = { x: 0, y: 548, width: 402, height: 326 };

  it('finds a field the keyboard-raised footer covers, and one the keyboard covers', () => {
    const read = covers(raisedFooterForm(), keyboard);
    expect(read.brand).toEqual('button "Next"');
    expect(read.size).toEqual('the keyboard');
    expect(read['product-name']).toBeUndefined();
    expect(read.back).toBeUndefined();
    expect(read.next).toBeUndefined();
  });

  it('leaves the keyboard, its keys, the bars it hosts, and the screen around it uncovered', () => {
    const read = covers(raisedFooterForm(), keyboard);
    expect(read.keyboard).toBeUndefined();
    expect(read.q).toBeUndefined();
    expect(read['Toolbar Done']).toBeUndefined();
    expect(read.application).toBeUndefined();
  });

  it('covers nothing when the capture measured no keyboard', () => {
    expect(covers(raisedFooterForm()).size).toBeUndefined();
  });
});
