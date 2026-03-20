// components/tour/TourMap.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { PoiTileItem } from '../../services/supabase';
import type { LocationFix } from '../../hooks/useLocation';
import type { QueuedPoi } from '../../stores/sessionStore';
import { distanceMeters } from '../../utils/geo';

type PoiState = 'UNVISITED' | 'QUEUED' | 'NARRATING' | 'COMPLETED' | 'SKIPPED';

type Props = {
  location: LocationFix | null;
  pois: PoiTileItem[];
  currentPoiId: string | null;
  poiStates: Record<string, PoiState>;
  queue: QueuedPoi[];
  onPoiPress?: (poi: PoiTileItem) => void;
};

function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: 600, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={[styles.narrating, { transform: [{ scale }] }]} />
  );
}

export function TourMap({ location, pois, currentPoiId, poiStates, queue, onPoiPress }: Props) {
  const lat = location?.lat ?? 29.9511;
  const lon = location?.lon ?? -90.0715;

  // Build a map of queue position by poi_id for opacity calculation
  const queueIndexMap: Record<string, number> = {};
  queue.forEach((q, i) => { queueIndexMap[q.id] = i; });

  return (
    <MapView
      style={StyleSheet.absoluteFillObject}
      provider={PROVIDER_GOOGLE}
      mapType="standard"
      customMapStyle={darkMapStyle}
      initialRegion={{ latitude: lat, longitude: lon, latitudeDelta: 0.008, longitudeDelta: 0.008 }}
      region={location ? { latitude: lat, longitude: lon, latitudeDelta: 0.008, longitudeDelta: 0.008 } : undefined}
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass={false}
      showsScale={false}
    >
      {pois.map((poi) => {
        const state = poiStates[poi.id] ?? 'UNVISITED';

        if (state === 'UNVISITED') return null;

        if (state === 'COMPLETED' || state === 'SKIPPED') {
          return (
            <Marker
              key={poi.id}
              coordinate={{ latitude: poi.lat, longitude: poi.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onPoiPress?.(poi)}
            >
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            </Marker>
          );
        }

        if (state === 'NARRATING') {
          return (
            <Marker
              key={poi.id}
              coordinate={{ latitude: poi.lat, longitude: poi.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <PulsingDot />
            </Marker>
          );
        }

        // QUEUED — fading label pins
        const queueIndex = queueIndexMap[poi.id] ?? 2;
        const opacity = queueIndex === 0 ? 1 : queueIndex === 1 ? 0.5 : 0.2;
        const isNext = queueIndex === 0;
        const dist = location
          ? Math.round(distanceMeters(lat, lon, poi.lat, poi.lon))
          : null;

        return (
          <Marker
            key={poi.id}
            coordinate={{ latitude: poi.lat, longitude: poi.lon }}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => onPoiPress?.(poi)}
          >
            <View style={{ opacity, alignItems: 'center' }}>
              <View style={[styles.labelBadge, isNext && styles.labelBadgeNext]}>
                <Text style={[styles.labelText, isNext && styles.labelTextNext]}>
                  {poi.name}{dist !== null ? ` · ${dist}m` : ''}
                </Text>
              </View>
              {isNext && <View style={styles.dot} />}
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  labelBadge: {
    backgroundColor: '#33333399',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  labelBadgeNext: { backgroundColor: '#e8a44aee', borderRadius: 4 },
  labelText: { fontSize: 10, color: '#ccc', fontWeight: '500' },
  labelTextNext: { color: '#000', fontWeight: '700' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#e8a44a', marginTop: 2 },
  narrating: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#e8a44a',
    borderWidth: 2, borderColor: '#fff',
  },
  checkmark: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#2a4a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  checkmarkText: { color: '#7ac47a', fontSize: 10, fontWeight: '700' },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
];
