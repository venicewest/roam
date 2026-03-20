// __mocks__/react-native.ts
// Minimal stub of react-native for Jest/Node tests.
export const Platform = { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default };
export const NativeModules = {};
export const NativeEventEmitter = class {};
export const EventEmitter = class {};
export const AppRegistry = { registerComponent: jest.fn() };
export const StyleSheet = { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 };
export const View = 'View';
export const Text = 'Text';
export const TouchableOpacity = 'TouchableOpacity';
export const Animated = {
  Value: class { constructor(v: number) {} interpolate() { return this; } },
  View: 'Animated.View',
  timing: () => ({ start: jest.fn() }),
  spring: () => ({ start: jest.fn() }),
};
export const Dimensions = { get: () => ({ width: 375, height: 812 }) };
export const AccessibilityInfo = { addEventListener: jest.fn(), removeEventListener: jest.fn() };
