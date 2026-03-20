# Billing History Screen — Design Spec

**Date:** 2026-03-20
**Scope:** New billing history screen accessible from profile and store; displays last 50 credit transactions with city context for tour charges.
**Affected files:** `app/billing-history.tsx` (new), `hooks/useBillingHistory.ts` (new), `app/_layout.tsx`, `app/(tabs)/profile.tsx`, `app/(tabs)/store.tsx`, `supabase/functions/get-billing-history/index.ts`, `services/supabase.ts`, `utils/formatting.ts`

---

## Problem Statement

Users have no way to view their credit transaction history in the app. The data exists (`credit_transactions` table, `get-billing-history` edge function returning last 50 rows) but there is no screen to display it.

---

## Section 1 — Entry Points

Two entry points navigate to `/billing-history`:

1. **Profile screen**: A new "Billing history" menu row. Final menu order becomes: Tour History → **Billing history** → Narration Voice → Buy Credits. Uses `router.push('/billing-history' as any)` consistent with the `voice-selector` pattern.
2. **Store screen**: A "View billing history" text link rendered **outside and below** the `loadingPackages` conditional, so it is always visible regardless of package load state.

No new tab is added — billing history is a stack screen pushed on top of the current tab.

---

## Section 2 — Screen Layout

**Header**: Native stack header with title "Billing history", dark background (`#1a1a2e`), white tint — added to `app/_layout.tsx`:
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

**Body**: A `FlatList` of transaction rows, most recent first. `keyExtractor` uses `item.id` (UUID).

**Loading state**: Centered `ActivityIndicator`. No data shown during loading.

**Empty state**: Centered layout — heading "No transactions yet", subtitle "Credits you earn and spend will appear here".

**Error state**: Centered "Couldn't load transactions" with a "Try again" button. Tapping it calls `refetch()`, which resets `error` to `null` synchronously and sets `loading` to `true` before the async fetch begins.

---

## Section 3 — Transaction Row

| Element | Detail |
|---|---|
| Icon | 🎧 `tour_charge` · 💳 `purchase` · 🎁 `promo` · ↩️ `refund` · ⚙️ `admin_adjust` |
| Type label | "Tour charge" / "Purchase" / "Promo" / "Refund" / "Adjustment" |
| Subline 1 | **`tour_charge` only**: city name in amber, sourced from `transaction.tour_sessions?.city`. Omitted if `tour_sessions` is null or city is empty. No subline for all other types. |
| Subline 2 | Date + time formatted as `"Mar 19 · 2:41 PM"` via new `formatTransactionDate(isoString)` helper in `utils/formatting.ts`. |
| Credit delta | Right-aligned. Red for `amount < 0` (e.g. `−1 credit`). Green for `amount > 0` (e.g. `+10 credits`). Muted grey for `amount === 0` (e.g. `0 credits`). Singular/plural: "1 credit" / "N credits". |
| Balance after | Right-aligned below delta, muted grey (e.g. "12 left", "0 left"). |

Rows are non-interactive.

---

## Section 4 — Edge Function Update

`get-billing-history` updated to join `tour_sessions(city)` so city is available for `tour_charge` rows:

```ts
const { data: transactions } = await adminClient
  .from("credit_transactions")
  .select("*, tour_sessions(city)")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false })
  .limit(50);
```

The admin client (service role) bypasses RLS, so the join succeeds regardless of session ownership. The city is purely informational context for the user reading their own transaction — no privacy concern.

---

## Section 5 — Type Update (`services/supabase.ts`)

`CreditTransaction` type must be extended to include the joined field:

```ts
export type CreditTransaction = {
  // ... existing fields ...
  tour_sessions: { city: string } | null;
};
```

---

## Section 6 — Hook (`hooks/useBillingHistory.ts`)

Uses `useState` + `useEffect` pattern (same as `useCredits`, `useTourSession` — not React Query):

```ts
const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

const refetch = useCallback(async () => {
  setError(null);   // clears error synchronously
  setLoading(true); // shows loading indicator immediately
  const result = await api.getBillingHistory();
  if (result.success) {
    setTransactions(result.data.transactions);
  } else {
    setError(result.error?.message ?? 'Unknown error');
  }
  setLoading(false);
}, []);

useEffect(() => { refetch(); }, []);
```

Exposes: `{ transactions, loading, error, refetch }`.

---

## Section 7 — New Date Formatter (`utils/formatting.ts`)

Add `formatTransactionDate(isoString: string): string` that produces `"Mar 19 · 2:41 PM"`:
```ts
export function formatTransactionDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}
```

---

## Section 8 — Files Changed

| File | Change |
|---|---|
| `app/billing-history.tsx` | New screen |
| `hooks/useBillingHistory.ts` | New hook |
| `app/_layout.tsx` | Add `Stack.Screen` entry for `billing-history` |
| `app/(tabs)/profile.tsx` | Add "Billing history" menu row (position: after Tour History) |
| `app/(tabs)/store.tsx` | Add "View billing history" link (outside loadingPackages conditional) |
| `supabase/functions/get-billing-history/index.ts` | Add `tour_sessions(city)` join |
| `services/supabase.ts` | Add `tour_sessions` field to `CreditTransaction` type |
| `utils/formatting.ts` | Add `formatTransactionDate` helper |

No migrations needed.

---

## Out of Scope

- Pagination beyond 50 transactions
- Filtering or searching transactions
- Displaying Stripe dollar amount for purchases
- Linking a tour charge row to the transcript screen
