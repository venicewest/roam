import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react' } }],
    '^.+\\.[jt]sx?$': ['ts-jest', { tsconfig: { jsx: 'react' } }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@testing-library/react-native|expo-av|expo|@expo)/)',
  ],
  moduleNameMapper: {
    // Mock native/Expo modules that can't run in Node
    '^@supabase/supabase-js$': '<rootDir>/__mocks__/@supabase/supabase-js.ts',
    '^./supabase$': '<rootDir>/__mocks__/services/supabase.ts',
    '^../supabase$': '<rootDir>/__mocks__/services/supabase.ts',
    // Stub react-native for hook tests
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
    '^@testing-library/react-native$': '<rootDir>/__mocks__/@testing-library/react-native.ts',
  },
};

export default config;
