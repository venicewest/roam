// __mocks__/@testing-library/react-native.ts
// Minimal renderHook + act for Node/ts-jest — delegates to react-test-renderer.
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
