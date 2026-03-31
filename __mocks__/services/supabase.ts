// Mock for services/supabase
export const supabase = {
  auth: {
    refreshSession: jest.fn().mockResolvedValue({ data: { session: null } }),
  },
};

// Re-export types as needed
export type PoiTileItem = Record<string, unknown>;
export type TourSession = Record<string, unknown>;
export type TourSessionPoi = Record<string, unknown>;
export type CreditPackage = Record<string, unknown>;
export type CreditTransaction = Record<string, unknown>;
