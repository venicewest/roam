import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react' } }],
  },
  moduleNameMapper: {
    // Mock native/Expo modules that can't run in Node
    '^@supabase/supabase-js$': '<rootDir>/__mocks__/@supabase/supabase-js.ts',
    '^./supabase$': '<rootDir>/__mocks__/services/supabase.ts',
    '^../supabase$': '<rootDir>/__mocks__/services/supabase.ts',
  },
};

export default config;
