import { formatTransactionDate } from '../formatting';

describe('formatTransactionDate', () => {
  it('formats an ISO string as "Mon DD · H:MM AM/PM"', () => {
    const result = formatTransactionDate('2026-03-19T14:41:00.000Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/);
  });

  it('handles midnight correctly', () => {
    const result = formatTransactionDate('2026-03-19T00:00:00.000Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/);
  });
});
