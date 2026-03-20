// __mocks__/@testing-library/react-native.ts
// Minimal renderHook + act + render + fireEvent for Node/ts-jest — delegates to react-test-renderer.
import React from 'react';
import { act as reactAct, create } from 'react-test-renderer';

export async function act(callback: () => Promise<void> | void): Promise<void> {
  await reactAct(async () => {
    await callback();
  });
}

export function renderHook<T>(hookFn: () => T): { result: { current: T } } {
  const result: { current: T } = { current: undefined as unknown as T };

  function TestComponent() {
    result.current = hookFn();
    return null;
  }

  let renderer: ReturnType<typeof create>;

  reactAct(() => {
    renderer = create(React.createElement(TestComponent));
  });

  // Re-render on each act call by wrapping result in a proxy-like accessor
  // The result.current is updated on every render of TestComponent.
  return { result };
}

// ---------------------------------------------------------------------------
// render / fireEvent — for component tests
// ---------------------------------------------------------------------------

function textMatches(node: any, text: string | RegExp): boolean {
  if (!node || !Array.isArray(node.children)) return false;
  const flat = node.children
    .map((c: any) => (typeof c === 'string' ? c : ''))
    .join('');
  return typeof text === 'string' ? flat === text || flat.includes(text) : text.test(flat);
}

function findByText(instance: ReturnType<typeof create>, text: string | RegExp): any {
  const root = instance.toJSON();
  if (!root) throw new Error(`Unable to find element with text: ${text}`);

  // Returns [node, ancestors] — we want the nearest pressable ancestor if available.
  function search(node: any, ancestors: any[]): any {
    if (!node || typeof node !== 'object') return null;

    if (textMatches(node, text)) {
      // Walk ancestors from nearest to find one with onPress
      for (let i = ancestors.length - 1; i >= 0; i--) {
        if (typeof ancestors[i].props?.onPress === 'function') {
          return ancestors[i];
        }
      }
      // No pressable ancestor — return this node (for text-only checks)
      return node;
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (typeof child === 'object') {
          const found = search(child, [...ancestors, node]);
          if (found) return found;
        }
      }
    }
    return null;
  }

  const nodes = Array.isArray(root) ? root : [root];
  for (const node of nodes) {
    const found = search(node, []);
    if (found) return found;
  }
  throw new Error(`Unable to find element with text: ${text}`);
}

export function render(element: React.ReactElement) {
  let instance: ReturnType<typeof create>;
  reactAct(() => {
    instance = create(element);
  });

  function getByText(text: string | RegExp) {
    return findByText(instance!, text);
  }

  function toJSON() {
    return instance!.toJSON();
  }

  return { getByText, toJSON };
}

export const fireEvent = {
  press(element: any) {
    if (!element) throw new Error('fireEvent.press: element is null');
    const props = element.props ?? {};
    if (typeof props.onPress === 'function') {
      props.onPress();
    }
    // If onPress is undefined, the button is effectively disabled — do nothing.
  },
};
