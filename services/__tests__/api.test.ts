// services/__tests__/api.test.ts
// Verify api type signatures include new fields.
import { api } from '../api';

describe('api', () => {
  it('synthesizePoi accepts optional depth_tier', () => {
    // TypeScript compile-time check — if this file compiles, the type is correct.
    type SynthesizeBody = Parameters<typeof api.synthesizePoi>[0];
    const body: SynthesizeBody = { poi_id: 'abc', depth_tier: 'quick' };
    expect(body.depth_tier).toBe('quick');
  });

  it('getPoiFollowup is defined', () => {
    expect(typeof api.getPoiFollowup).toBe('function');
  });
});
