// services/__tests__/api.test.ts
// Verify api type signatures include new fields.
import { api } from '../api';

// Mock supabase module
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      refreshSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'fake.jwt.token' } },
      }),
    },
  },
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

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

  describe('api.submitPoi', () => {
    it('calls submit-poi with correct body', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({ success: true, data: { poi_id: 'poi-abc' } }),
      });
      const result = await api.submitPoi('Old Clock Tower', 2, 40.7128, -74.006);
      expect(result.success).toBe(true);
      expect(result.data?.poi_id).toBe('poi-abc');
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body);
      expect(body).toMatchObject({ name: 'Old Clock Tower', category_id: 2, lat: 40.7128, lng: -74.006 });
    });
  });
});
