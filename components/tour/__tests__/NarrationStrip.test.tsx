// components/tour/__tests__/NarrationStrip.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NarrationStrip } from '../NarrationStrip';

const mockPoi = {
  id: 'poi-1',
  name: 'Tower Bridge',
  lat: 51.5,
  lon: -0.07,
  tier: 1 as const,
  category_id: 8,
  has_audio_cache: false,
  distance_meters: 120,
  priority: 1,
  state: 'NARRATING' as const,
};

describe('NarrationStrip', () => {
  const defaultProps = {
    poi: mockPoi,
    narrative: 'Built in 1894, this Victorian masterpiece spans the Thames.',
    isPaused: false,
    isInGap: false,
    followupRequested: false,
    onReplay: jest.fn(),
    onMore: jest.fn(),
    onPause: jest.fn(),
    onSkip: jest.fn(),
  };

  it('renders POI name', () => {
    const { getByText } = render(<NarrationStrip {...defaultProps} />);
    expect(getByText('Tower Bridge')).toBeTruthy();
  });

  it('shows paused state when isPaused', () => {
    const { getByText } = render(
      <NarrationStrip {...defaultProps} isPaused={true} />
    );
    expect(getByText(/paused/i)).toBeTruthy();
  });

  it('calls onSkip when Skip pressed', () => {
    const onSkip = jest.fn();
    const { getByText } = render(<NarrationStrip {...defaultProps} onSkip={onSkip} />);
    fireEvent.press(getByText('Skip'));
    expect(onSkip).toHaveBeenCalled();
  });

  it('calls onMore when More pressed', () => {
    const onMore = jest.fn();
    const { getByText } = render(<NarrationStrip {...defaultProps} onMore={onMore} />);
    fireEvent.press(getByText('More'));
    expect(onMore).toHaveBeenCalled();
  });

  it('disables More when followupRequested', () => {
    const onMore = jest.fn();
    const { getByText } = render(
      <NarrationStrip {...defaultProps} followupRequested={true} onMore={onMore} />
    );
    fireEvent.press(getByText('More'));
    expect(onMore).not.toHaveBeenCalled();
  });

  it('disables Replay and Skip when isInGap', () => {
    const onReplay = jest.fn();
    const onSkip = jest.fn();
    const { getByText } = render(
      <NarrationStrip {...defaultProps} isInGap={true} onReplay={onReplay} onSkip={onSkip} />
    );
    fireEvent.press(getByText('Replay'));
    fireEvent.press(getByText('Skip'));
    expect(onReplay).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });
});
