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
