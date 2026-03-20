// hooks/__tests__/useGroupTour.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useGroupTour } from '../useGroupTour';
import { useSessionStore } from '../../stores/sessionStore';

jest.mock('../../services/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn(),
      send: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('../../stores/sessionStore', () => ({
  useSessionStore: jest.fn(),
}));

describe('useGroupTour', () => {
  const mockSend = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useSessionStore).mockReturnValue({
      session: { is_group_tour: true, join_code: 'ABC123' },
    } as any);
    const { supabase } = require('../../services/supabase');
    (supabase.channel as jest.Mock).mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn(),
      send: mockSend,
    });
  });

  it('broadcastPause sends SESSION_STATE PAUSED', async () => {
    const { result } = renderHook(() => useGroupTour({}));
    await act(async () => { await result.current.broadcastPause(); });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SESSION_STATE', payload: { status: 'paused' } })
    );
  });

  it('broadcastResume sends SESSION_STATE RESUMED', async () => {
    const { result } = renderHook(() => useGroupTour({}));
    await act(async () => { await result.current.broadcastResume(); });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SESSION_STATE', payload: { status: 'resumed' } })
    );
  });

  it('broadcastNarration includes optional poi_description and category_name', async () => {
    const { result } = renderHook(() => useGroupTour({}));
    await act(async () => {
      await result.current.broadcastNarration('poi-1', 'http://a.mp3', 'Tower Bridge', 'Victorian era bridge.', 'History');
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'POI_NARRATE',
        payload: expect.objectContaining({ poi_description: 'Victorian era bridge.', category_name: 'History' }),
      })
    );
  });
});
