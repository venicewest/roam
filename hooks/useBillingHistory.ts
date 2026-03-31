import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { CreditTransaction } from '../services/supabase';

type State = {
  transactions: CreditTransaction[];
  loading: boolean;
  error: string | null;
};

export function useBillingHistory() {
  const [state, setState] = useState<State>({
    transactions: [],
    loading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    setState(s => ({ ...s, error: null, loading: true }));
    const result = await api.getBillingHistory();
    if (result.success && result.data) {
      setState({ transactions: result.data.transactions, loading: false, error: null });
    } else {
      setState(s => ({
        ...s,
        loading: false,
        error: result.error?.message ?? 'Unknown error',
      }));
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { ...state, refetch };
}
