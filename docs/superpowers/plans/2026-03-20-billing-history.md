# Billing History Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a billing history screen that shows the last 50 credit transactions, accessible from the profile menu and the store screen.

**Architecture:** New `useBillingHistory` hook fetches from the existing `get-billing-history` edge function (updated to join `tour_sessions(city)`). A new stack screen `app/billing-history.tsx` renders a `FlatList` of transaction rows. Two entry points: profile menu row and store screen text link.

**Tech Stack:** React Native, Expo Router, Supabase Edge Functions, TypeScript, Jest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `utils/formatting.ts` | Modify | Add `formatTransactionDate` helper |
| `services/supabase.ts` | Modify | Add `tour_sessions` field to `CreditTransaction` type |
| `supabase/functions/get-billing-history/index.ts` | Modify | Add `tour_sessions(city)` join |
| `hooks/useBillingHistory.ts` | Create | Fetch + loading/error/refetch state |
| `app/billing-history.tsx` | Create | Screen: FlatList of transaction rows |
| `app/_layout.tsx` | Modify | Register `billing-history` Stack.Screen |
| `app/(tabs)/profile.tsx` | Modify | Add "Billing history" menu row |
| `app/(tabs)/store.tsx` | Modify | Add "View billing history" text link |

---

## Task 1: `formatTransactionDate` utility

**Files:**
- Modify: `utils/formatting.ts`
- Test: `utils/__tests__/formatting.test.ts` (create if missing)

- [ ] **Step 1.1: Write the failing test**

Add to `utils/__tests__/formatting.test.ts`:

```ts
import { formatTransactionDate } from '../formatting';

describe('formatTransactionDate', () => {
  it('formats an ISO string as "Mon DD · H:MM AM/PM"', () => {
    // 2026-03-19T14:41:00.000Z in US locale
    const result = formatTransactionDate('2026-03-19T14:41:00.000Z');
    // Time zone varies by machine — just verify the shape
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/);
  });

  it('handles midnight correctly', () => {
    const result = formatTransactionDate('2026-03-19T00:00:00.000Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/);
  });
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
npx jest --testPathPatterns="utils/__tests__/formatting" --no-coverage --forceExit
```
Expected: FAIL — `formatTransactionDate is not a function`

- [ ] **Step 1.3: Implement `formatTransactionDate` in `utils/formatting.ts`**

Add at the end of the file:

```ts
/**
 * Formats a Supabase ISO timestamp for transaction rows.
 * Output: "Mar 19 · 2:41 PM"
 */
export function formatTransactionDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}
```

- [ ] **Step 1.4: Run test to confirm it passes**

```bash
npx jest --testPathPatterns="utils/__tests__/formatting" --no-coverage --forceExit
```
Expected: PASS

- [ ] **Step 1.5: Commit**

```bash
git add utils/formatting.ts utils/__tests__/formatting.test.ts
git commit -m "feat: add formatTransactionDate helper to utils/formatting"
```

---

## Task 2: Type update + edge function join

**Files:**
- Modify: `services/supabase.ts` (line ~119, `CreditTransaction` type)
- Modify: `supabase/functions/get-billing-history/index.ts`

- [ ] **Step 2.1: Add `tour_sessions` field to `CreditTransaction` in `services/supabase.ts`**

Find `CreditTransaction` type (currently ends at `created_at: string;`) and add one field:

```ts
export type CreditTransaction = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  transaction_type: 'purchase' | 'tour_charge' | 'refund' | 'promo' | 'admin_adjust';
  tour_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  tour_sessions: { city: string } | null;  // joined — only present for tour_charge rows
};
```

- [ ] **Step 2.2: Update `get-billing-history` select to join `tour_sessions(city)`**

In `supabase/functions/get-billing-history/index.ts`, change the query from:

```ts
.select("*")
```

to:

```ts
.select("*, tour_sessions(city)")
```

The rest of the function is unchanged. The admin client (service role) performs the join without RLS issues.

- [ ] **Step 2.3: Commit**

```bash
git add services/supabase.ts supabase/functions/get-billing-history/index.ts
git commit -m "feat: add tour_sessions city join to get-billing-history"
```

---

## Task 3: `useBillingHistory` hook

**Files:**
- Create: `hooks/useBillingHistory.ts`
- Create: `hooks/__tests__/useBillingHistory.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `hooks/__tests__/useBillingHistory.test.ts`:

```ts
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

    act(() => { result.current.refetch(); });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transactions).toHaveLength(1);
  });
});
```

- [ ] **Step 3.2: Run to confirm it fails**

```bash
npx jest --testPathPatterns="hooks/__tests__/useBillingHistory" --no-coverage --forceExit
```
Expected: FAIL — `Cannot find module '../useBillingHistory'`

- [ ] **Step 3.3: Implement `hooks/useBillingHistory.ts`**

```ts
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

  useEffect(() => { refetch(); }, [refetch]);

  return { ...state, refetch };
}
```

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
npx jest --testPathPatterns="hooks/__tests__/useBillingHistory" --no-coverage --forceExit
```
Expected: PASS (4 tests)

- [ ] **Step 3.5: Commit**

```bash
git add hooks/useBillingHistory.ts hooks/__tests__/useBillingHistory.test.ts
git commit -m "feat: add useBillingHistory hook"
```

---

## Task 4: Billing history screen + route registration

**Files:**
- Create: `app/billing-history.tsx`
- Modify: `app/_layout.tsx`

- [ ] **Step 4.1: Register the route in `app/_layout.tsx`**

Inside the `<Stack>` block (after the `voice-selector` Screen entry), add:

```tsx
<Stack.Screen
  name="billing-history"
  options={{
    headerShown: true,
    title: 'Billing history',
    headerStyle: { backgroundColor: '#1a1a2e' },
    headerTintColor: '#ffffff',
  }}
/>
```

- [ ] **Step 4.2: Create `app/billing-history.tsx`**

```tsx
import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useBillingHistory } from '../hooks/useBillingHistory';
import { formatTransactionDate } from '../utils/formatting';
import type { CreditTransaction } from '../services/supabase';

const TYPE_ICON: Record<CreditTransaction['transaction_type'], string> = {
  tour_charge: '🎧',
  purchase: '💳',
  promo: '🎁',
  refund: '↩️',
  admin_adjust: '⚙️',
};

const TYPE_LABEL: Record<CreditTransaction['transaction_type'], string> = {
  tour_charge: 'Tour charge',
  purchase: 'Purchase',
  promo: 'Promo',
  refund: 'Refund',
  admin_adjust: 'Adjustment',
};

function deltaColor(amount: number): string {
  if (amount < 0) return '#ff6b6b';
  if (amount > 0) return '#4ecb71';
  return '#666';
}

function deltaText(amount: number): string {
  const abs = Math.abs(amount);
  const credits = abs === 1 ? 'credit' : 'credits';
  if (amount < 0) return `−${abs} ${credits}`;
  if (amount > 0) return `+${abs} ${credits}`;
  return `0 credits`;
}

function TransactionRow({ item }: { item: CreditTransaction }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.icon}>{TYPE_ICON[item.transaction_type]}</Text>
        <View>
          <Text style={styles.typeLabel}>{TYPE_LABEL[item.transaction_type]}</Text>
          {item.transaction_type === 'tour_charge' && item.tour_sessions?.city ? (
            <Text style={styles.city}>{item.tour_sessions.city}</Text>
          ) : null}
          <Text style={styles.date}>{formatTransactionDate(item.created_at)}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.delta, { color: deltaColor(item.amount) }]}>
          {deltaText(item.amount)}
        </Text>
        <Text style={styles.balance}>{item.balance_after} left</Text>
      </View>
    </View>
  );
}

export default function BillingHistoryScreen() {
  const { transactions, loading, error, refetch } = useBillingHistory();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f0a500" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn't load transactions</Text>
        <TouchableOpacity onPress={refetch} style={styles.retryButton}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={transactions}
      keyExtractor={item => item.id}
      renderItem={({ item }) => <TransactionRow item={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No transactions yet</Text>
          <Text style={styles.emptySubtitle}>Credits you earn and spend will appear here</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#111',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  icon: { fontSize: 20, marginTop: 1 },
  typeLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  city: { color: '#f0a500', fontSize: 12, marginTop: 2 },
  date: { color: '#666', fontSize: 11, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  delta: { fontSize: 14, fontWeight: '700' },
  balance: { color: '#555', fontSize: 11, marginTop: 2 },
  separator: { height: 1, backgroundColor: '#1a1a1a' },
  errorText: { color: '#fff', fontSize: 15, marginBottom: 12 },
  retryButton: { backgroundColor: '#f0a500', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#000', fontWeight: '700' },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: '#666', fontSize: 13, textAlign: 'center' },
});
```

- [ ] **Step 4.3: Commit**

```bash
git add app/billing-history.tsx app/_layout.tsx
git commit -m "feat: add billing history screen and route"
```

---

## Task 5: Entry points (profile + store)

**Files:**
- Modify: `app/(tabs)/profile.tsx`
- Modify: `app/(tabs)/store.tsx`

- [ ] **Step 5.1: Add "Billing history" row to profile menu**

In `app/(tabs)/profile.tsx`, inside `<View style={styles.menu}>`, insert a new `TouchableOpacity` **after** the "Tour History" row and **before** the "Narration Voice" row:

```tsx
<TouchableOpacity
  style={styles.menuItem}
  onPress={() => router.push('/billing-history' as any)}
>
  <Text style={styles.menuItemText}>🧾 Billing history</Text>
  <Text style={styles.menuArrow}>→</Text>
</TouchableOpacity>
```

- [ ] **Step 5.2: Add "View billing history" link to store screen**

In `app/(tabs)/store.tsx`, after the closing `}` of the `loadingPackages ? (...) : packages.map(...)` expression (i.e., outside/below the conditional), add:

```tsx
<TouchableOpacity
  onPress={() => router.push('/billing-history' as any)}
  style={{ paddingVertical: 16, alignItems: 'center' }}
>
  <Text style={{ color: '#f0a500', fontSize: 13 }}>View billing history →</Text>
</TouchableOpacity>
```

Make sure `router` is imported from `expo-router` at the top of the file (add if not already present).

- [ ] **Step 5.3: Run all existing tests to confirm nothing is broken**

```bash
npx jest --testPathPatterns="components/tour|hooks/__tests__|services/__tests__|utils/__tests__" --no-coverage --forceExit
```
Expected: all pass

- [ ] **Step 5.4: Commit**

```bash
git add "app/(tabs)/profile.tsx" "app/(tabs)/store.tsx"
git commit -m "feat: add billing history entry points in profile and store"
```
