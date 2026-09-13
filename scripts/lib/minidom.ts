/**
 * A DOM small enough to run the exported viewer in Node, and honest enough
 * that if the viewer works here it will work in a browser opened from a
 * file:// URL. It exists because "double-click archive.html and it works" is
 * the one requirement that cannot be checked by reading the code.
 *
 * Deliberately not a browser: no layout, no paint, and getContext returns
 * null - which also exercises the viewer's no-canvas fallback path.
 */

export class MiniNode {
  children: MiniNode[] = [];
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  className = "";
  value = "";
  private ownText = "";
  parent: MiniNode | null = null;

  constructor(public tagName: string) {}

  appendChild(child: MiniNode): MiniNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MiniNode): void {
    this.children = this.children.filter((c) => c !== child);
  }

  set textContent(value: string) {
    this.children = [];
    this.ownText = value;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }

  set innerHTML(value: string) {
    this.children = [];
    this.ownText = value.replace(/<[^>]+>/g, " ");
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === "class") this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }

  dispatch(type: string, ev: unknown = {}): void {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...(ev as object) });
  }

  focus(): void {}
  setPointerCapture(): void {}
  getContext(): null {
    return null;
  }
  getBoundingClientRect() {
    return { width: 900, height: 640, left: 0, top: 0, right: 900, bottom: 640, x: 0, y: 0 };
  }

  /** Every node in the subtree, for assertions. */
  all(): MiniNode[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }

  find(predicate: (n: MiniNode) => boolean): MiniNode | undefined {
    return this.all().find(predicate);
  }

  links(): string[] {
    return this.all()
      .filter((n) => n.tagName === "a" && n.attrs.href)
      .map((n) => n.attrs.href);
  }
}

export interface MiniWindow {
  document: {
    body: MiniNode;
    getElementById(id: string): MiniNode | null;
    createElement(tag: string): MiniNode;
    createTextNode(text: string): MiniNode;
  };
  location: { hash: string };
  run(source: string): void;
  byId(id: string): MiniNode;
}

/**
 * Builds the document the exported page describes: the opening section, the
 * enter button, and the empty <main id="app"> the viewer renders into.
 */
export function createMiniWindow(archiveJson: string): MiniWindow {
  const registry = new Map<string, MiniNode>();
  const make = (tag: string, id?: string) => {
    const node = new MiniNode(tag);
    if (id) {
      node.attrs.id = id;
      registry.set(id, node);
    }
    return node;
  };

  const body = make("body");
  const data = make("script", "archive-data");
  data.textContent = archiveJson;
  const opening = make("section", "opening");
  const enter = make("button", "enter");
  const app = make("main", "app");
  opening.appendChild(enter);
  body.appendChild(opening);
  body.appendChild(app);
  body.appendChild(data);

  const document = {
    body,
    getElementById: (id: string) => registry.get(id) ?? null,
    createElement: (tag: string) => new MiniNode(tag),
    createTextNode: (text: string) => {
      const node = new MiniNode("#text");
      node.textContent = text;
      return node;
    },
  };

  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  let hash = "";

  // One stable location object: the viewer captures it once, and assigning to
  // .hash has to fire hashchange the way a browser does.
  const locationObj = {
    get hash(): string {
      return hash;
    },
    set hash(value: string) {
      hash = value.startsWith("#") ? value : `#${value}`;
      for (const fn of listeners.hashchange ?? []) fn({});
    },
  };

  const win: Record<string, unknown> = {
    document,
    location: locationObj,
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    scrollTo: () => {},
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    clearTimeout: () => {},
    devicePixelRatio: 1,
    history: { length: 1, back: () => {} },
    navigator: { onLine: false },
    performance: { now: () => Date.now() },
  };

  return {
    document,
    location: locationObj,
    byId(id: string): MiniNode {
      const node = registry.get(id);
      if (!node) throw new Error(`no element with id ${id}`);
      return node;
    },
    run(source: string): void {
      // The viewer is an IIFE that reads only these globals.
      const fn = new Function(
        "window",
        "document",
        "location",
        "history",
        "navigator",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "setTimeout",
        "clearTimeout",
        source,
      );
      fn(
        win,
        document,
        locationObj,
        win.history,
        win.navigator,
        win.performance,
        win.requestAnimationFrame,
        win.cancelAnimationFrame,
        win.setTimeout,
        win.clearTimeout,
      );
    },
  };
}
