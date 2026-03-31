import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useBillingHistory } from '../useBillingHistory';
import { api } from '../../services/api';

jest.mock('../../services/api', () => ({
  api: {
    getBillingHistory: jest.fn(),
  },
}));

const mockTransaction = {
  id: 'tx-1',
  user_id: 'user-1',
  amount: -1,
  balance_after: 12,
  transaction_type: 'tour_charge' as const,
  tour_session_id: 'sess-1',
  stripe_payment_intent_id: null,
  created_at: '2026-03-19T14:41:00.000Z',
  tour_sessions: { city: 'New York City' },
};

describe('useBillingHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts in loading state', () => {
    (api.getBillingHistory as jest.Mock).mockResolvedValue({
      success: true,
      data: { transactions: [] },
    });
    const { result } = renderHook(() => useBillingHistory());
    expect(result.current.loading).toBe(true);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('populates transactions on success', async () => {
    (api.getBillingHistory as jest.Mock).mockResolvedValue({
      success: true,
      data: { transactions: [mockTransaction] },
    });
    const { result } = renderHook(() => useBillingHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.transactions[0].tour_sessions?.city).toBe('New York City');
    expect(result.current.error).toBeNull();
  });

  it('sets error on failure', async () => {
    (api.getBillingHistory as jest.Mock).mockResolvedValue({
      success: false,
      error: { code: 'server_error', message: 'Oops' },
    });
    const { result } = renderHook(() => useBillingHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Oops');
    expect(result.current.transactions).toEqual([]);
  });

  it('refetch resets error and loading before re-fetching', async () => {
    (api.getBillingHistory as jest.Mock)
      .mockResolvedValueOnce({ success: false, error: { code: 'err', message: 'fail' } })
      .mockResolvedValueOnce({ success: true, data: { transactions: [mockTransaction] } });

    const { result } = renderHook(() => useBillingHistory());
    await waitFor(() => expect(result.current.error).toBe('fail'));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.transactions).toHaveLength(1);
  });
});
