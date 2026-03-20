// components/shared/SubmitPoiSheet.tsx
import React from 'react';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../../services/api';
import { BottomSheet } from './BottomSheet';

type Category = { id: number; name: string; emoji: string };
type LocationState =
  | { status: 'loading' }
  | { status: 'ready'; lat: number; lng: number }
  | { status: 'error'; message: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Pre-filled coords (e.g. from active tour). If provided, skips GPS request. */
  initialCoords?: { lat: number; lng: number };
};

export function SubmitPoiSheet({ visible, onClose, initialCoords }: Props) {
  const [name, setName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [location, setLocation] = useState<LocationState>({ status: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Reset form on every open
  useEffect(() => {
    if (!visible) return;
    setName('');
    setSelectedCategory(null);
    setSubmitting(false);
    setToast(null);
  }, [visible]);

  // Fetch categories on mount
  useEffect(() => {
    const { supabase } = require('../../services/supabase');
    supabase
      .from('interest_categories')
      .select('id, name, emoji')
      .order('id')
      .then(({ data }: { data: Category[] | null }) => {
        if (data) setCategories(data);
      });
  }, []);

  // Resolve location on open
  useEffect(() => {
    if (!visible) return;
    if (initialCoords) {
      setLocation({ status: 'ready', lat: initialCoords.lat, lng: initialCoords.lng });
      return;
    }
    (async () => {
      setLocation({ status: 'loading' });
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocation({ status: 'error', message: 'Location permission required' });
        return;
      }
      try {
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        setLocation({ status: 'ready', lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        setLocation({ status: 'error', message: 'Location unavailable — move to an open area' });
      }
    })();
  }, [visible, initialCoords]);

  const canSubmit =
    name.trim().length > 0 &&
    selectedCategory !== null &&
    location.status === 'ready' &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || location.status !== 'ready') return;
    setSubmitting(true);
    const result = await api.submitPoi(
      name.trim(),
      selectedCategory!.id,
      location.lat,
      location.lng,
    );
    setSubmitting(false);
    if (result.success) {
      setToast('Thanks! Your suggestion is being added.');
      setTimeout(() => {
        setToast(null);
        onClose();
      }, 1500);
    } else {
      setToast("Couldn't submit — please try again");
      setTimeout(() => setToast(null), 3000);
    }
  }, [canSubmit, location, name, selectedCategory, onClose]);

  return (
    <BottomSheet visible={visible} onClose={onClose} snapHeight={520}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* Title */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Suggest a place</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {/* Name */}
          <Text style={styles.label}>PLACE NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. The old clock tower"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
          />

          {/* Category */}
          <Text style={styles.label}>CATEGORY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {categories.length === 0
              ? [1, 2, 3, 4].map(i => <View key={i} style={styles.pillSkeleton} />)
              : categories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.pill, selectedCategory?.id === cat.id && styles.pillSelected]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text style={[styles.pillText, selectedCategory?.id === cat.id && styles.pillTextSelected]}>
                      {cat.emoji} {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
          </ScrollView>

          {/* Location */}
          <Text style={styles.label}>LOCATION</Text>
          <View style={styles.locationBox}>
            {location.status === 'loading' && (
              <View style={styles.locationRow}>
                <ActivityIndicator size="small" color="#f0a500" />
                <Text style={styles.locationText}>Getting your location...</Text>
              </View>
            )}
            {location.status === 'ready' && (
              <View>
                <Text style={styles.locationText}>Your current location</Text>
                <Text style={styles.locationCoords}>
                  {location.lat.toFixed(4)}° N, {Math.abs(location.lng).toFixed(4)}° W
                </Text>
              </View>
            )}
            {location.status === 'error' && (
              <Text style={styles.locationError}>{location.message}</Text>
            )}
          </View>

          {/* Toast */}
          {toast && <Text style={styles.toast}>{toast}</Text>}

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityState={{ disabled: !canSubmit }}
          >
            {submitting
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.submitText}>Submit suggestion</Text>}
          </TouchableOpacity>

          {/* Disclaimer */}
          <Text style={styles.disclaimer}>
            AI will generate a narration for your suggestion.{'\n'}
            It may appear on tours within minutes.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  close: { color: '#888', fontSize: 14 },
  body: { paddingHorizontal: 20 },
  label: { color: '#aaa', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginTop: 18, marginBottom: 6 },
  input: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14 },
  pillRow: { flexDirection: 'row' },
  pill: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  pillSelected: { backgroundColor: '#f0a500', borderColor: '#f0a500' },
  pillText: { color: '#aaa', fontSize: 12 },
  pillTextSelected: { color: '#000', fontWeight: '600' },
  pillSkeleton: { width: 80, height: 30, backgroundColor: '#222', borderRadius: 20, marginRight: 8 },
  locationBox: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 12 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationText: { color: '#fff', fontSize: 13 },
  locationCoords: { color: '#666', fontSize: 11, marginTop: 3 },
  locationError: { color: '#ff6b6b', fontSize: 13 },
  toast: { color: '#ff6b6b', fontSize: 13, textAlign: 'center', marginTop: 12 },
  submitButton: { backgroundColor: '#f0a500', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20 },
  submitButtonDisabled: { opacity: 0.4 },
  submitText: { color: '#000', fontWeight: '700', fontSize: 15 },
  disclaimer: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12, marginBottom: 24, lineHeight: 17 },
});
