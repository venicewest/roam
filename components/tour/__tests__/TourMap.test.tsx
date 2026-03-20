// components/tour/__tests__/TourMap.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { TourMap } from '../TourMap';

jest.mock('react-native-maps', () => {
  const MockMapView = ({ children }: any) => <>{children}</>;
  const MockMarker = ({ testID, children }: any) => <>{children}</>;
  return { __esModule: true, default: MockMapView, Marker: MockMarker, PROVIDER_GOOGLE: 'google' };
});

const location = { lat: 51.5, lon: -0.07, accuracy: 5, heading: 0, speed: 1.0, timestamp: 0 };
const pois = [
  { id: 'poi-1', name: 'Tower Bridge', lat: 51.505, lon: -0.075, tier: 1 as const, category_id: 8, has_audio_cache: false, distance_meters: 100 },
  { id: 'poi-2', name: 'St. Paul', lat: 51.513, lon: -0.098, tier: 1 as const, category_id: 1, has_audio_cache: false, distance_meters: 200 },
];

describe('TourMap', () => {
  it('renders without crashing with poiStates and queue', () => {
    const { toJSON } = render(
      <TourMap
        location={location}
        pois={pois}
        currentPoiId={null}
        poiStates={{ 'poi-1': 'QUEUED', 'poi-2': 'UNVISITED' }}
        queue={[{ ...pois[0], state: 'QUEUED', priority: 1 }]}
      />
    );
    expect(toJSON()).toBeTruthy();
  });

  it('renders completed pin for COMPLETED state', () => {
    const { getByText } = render(
      <TourMap
        location={location}
        pois={pois}
        currentPoiId={null}
        poiStates={{ 'poi-1': 'COMPLETED', 'poi-2': 'UNVISITED' }}
        queue={[]}
      />
    );
    expect(getByText('✓')).toBeTruthy();
  });
});
