import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SubmitPoiSheet } from '../SubmitPoiSheet';
import { api } from '../../../services/api';
import * as Location from 'expo-location';

jest.mock('../../../services/api', () => ({
  api: { submitPoi: jest.fn() },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('../BottomSheet', () => ({
  BottomSheet: ({ children, visible }: any) => visible ? <>{children}</> : null,
}));

// Mock supabase for category fetch
jest.mock('../../../services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          then: (cb: any) => cb({ data: [{ id: 1, name: 'History', emoji: '🏛' }] }),
        }),
      }),
    }),
  },
}));

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
};

describe('SubmitPoiSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 40.7128, longitude: -74.006 },
    });
  });

  it('renders name input and submit button', async () => {
    const { getByPlaceholderText, getByText } = render(<SubmitPoiSheet {...defaultProps} />);
    expect(getByPlaceholderText('e.g. The old clock tower')).toBeTruthy();
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());
  });

  it('submit button is disabled until name + category + location are set', async () => {
    const { getByText } = render(<SubmitPoiSheet {...defaultProps} />);
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());
    // No name, no category — button should be disabled
    expect(getByText('Submit suggestion').props.accessibilityState?.disabled).toBe(true);
  });

  it('calls api.submitPoi with correct args on submit', async () => {
    (api.submitPoi as jest.Mock).mockResolvedValue({ success: true, data: { poi_id: 'poi-1' } });
    const { getByPlaceholderText, getByText } = render(<SubmitPoiSheet {...defaultProps} />);
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. The old clock tower'), 'Old Clock Tower');
    // Tap the category pill
    await waitFor(() => expect(getByText('🏛 History')).toBeTruthy());
    fireEvent.press(getByText('🏛 History'));

    fireEvent.press(getByText('Submit suggestion'));
    await waitFor(() => expect(api.submitPoi).toHaveBeenCalledWith(
      'Old Clock Tower', 1, 40.7128, -74.006
    ));
  });

  it('stays open on API failure', async () => {
    (api.submitPoi as jest.Mock).mockResolvedValue({
      success: false, error: { code: 'server_error', message: 'Oops' },
    });
    const { getByPlaceholderText, getByText } = render(<SubmitPoiSheet {...defaultProps} />);
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. The old clock tower'), 'Some Place');
    await waitFor(() => expect(getByText('🏛 History')).toBeTruthy());
    fireEvent.press(getByText('🏛 History'));
    fireEvent.press(getByText('Submit suggestion'));

    await waitFor(() => expect(defaultProps.onClose).not.toHaveBeenCalled());
  });
});
