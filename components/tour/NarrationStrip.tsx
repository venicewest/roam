// components/tour/NarrationStrip.tsx
// Fixed bottom strip showing current POI + narration controls.
// Replaces the slide-up NarrationCard overlay.
import React, { useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { QueuedPoi } from '../../stores/sessionStore';

type Props = {
  poi: QueuedPoi | null;
  narrative: string | null;
  isPaused: boolean;
  isInGap: boolean;
  followupRequested: boolean;
  onReplay: () => void;
  onMore: () => void;
  onPause: () => void;
  onSkip: () => void;
};

export function NarrationStrip({
  poi,
  narrative,
  isPaused,
  isInGap,
  followupRequested,
  onReplay,
  onMore,
  onPause,
  onSkip,
}: Props) {
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 40 && Math.abs(gs.dy) < 20,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -40 && !isInGap) onSkip();
      },
    }),
  ).current;

  const poiName = poi?.name ?? 'Nearby location';
  const preview = narrative ? narrative.split('.')[0].slice(0, 80) + '…' : '';

  return (
    <View style={styles.strip} {...panResponder.panHandlers}>
      <View style={styles.textArea}>
        <Text style={styles.poiName} numberOfLines={1}>
          {poiName}
        </Text>
        {isPaused ? (
          <Text style={styles.pausedLabel}>Paused — tap ▶ to resume</Text>
        ) : (
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>
        )}
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, isInGap && styles.btnDisabled]}
          onPress={isInGap ? undefined : onReplay}
          activeOpacity={isInGap ? 1 : 0.7}
        >
          <Text style={[styles.btnText, isInGap && styles.btnTextDisabled]}>
            Replay
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, followupRequested && styles.btnDisabled]}
          onPress={followupRequested ? undefined : onMore}
          activeOpacity={followupRequested ? 1 : 0.7}
        >
          <Text style={[styles.btnText, followupRequested && styles.btnTextDisabled]}>
            More
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={onPause} activeOpacity={0.7}>
          <Text style={styles.btnText}>{isPaused ? '▶' : '⏸'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, isInGap && styles.btnDisabled]}
          onPress={isInGap ? undefined : onSkip}
          activeOpacity={isInGap ? 1 : 0.7}
        >
          <Text style={[styles.btnText, isInGap && styles.btnTextDisabled]}>
            Skip
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: '#0d1a0d',
    borderTopWidth: 1,
    borderTopColor: '#1a2a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 110,
  },
  textArea: { marginBottom: 10 },
  poiName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 3 },
  preview: { fontSize: 13, color: '#7ac47a', lineHeight: 18 },
  pausedLabel: { fontSize: 13, color: '#888', fontStyle: 'italic' },
  buttons: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    backgroundColor: '#1a2a1a',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#7ac47a', fontSize: 13, fontWeight: '600' },
  btnTextDisabled: { color: '#555' },
});
