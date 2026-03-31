// hooks/__tests__/useAudioPlayer.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { Audio } from 'expo-av';
import { useAudioPlayer } from '../useAudioPlayer';

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(),
    },
    setAudioModeAsync: jest.fn(),
  },
}));

const mockSound = {
  playAsync: jest.fn().mockResolvedValue(undefined),
  stopAsync: jest.fn().mockResolvedValue(undefined),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  playFromPositionAsync: jest.fn().mockResolvedValue(undefined),
  getStatusAsync: jest.fn().mockResolvedValue({ isLoaded: true, positionMillis: 5000 }),
};

beforeEach(() => {
  jest.clearAllMocks();
  (Audio.Sound.createAsync as jest.Mock).mockResolvedValue({ sound: mockSound });
});

describe('useAudioPlayer', () => {
  it('replay() calls playFromPositionAsync(0)', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });

    await act(async () => {
      await result.current.replay();
    });

    expect(mockSound.playFromPositionAsync).toHaveBeenCalledWith(0);
  });

  it('pause() stores positionMillis and sets isPaused', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(mockSound.pauseAsync).toHaveBeenCalled();
    expect(result.current.isPaused).toBe(true);
  });

  it('resume() calls playFromPositionAsync with stored position', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });
    await act(async () => { await result.current.pause(); });
    await act(async () => { await result.current.resume(); });

    expect(mockSound.playFromPositionAsync).toHaveBeenCalledWith(5000);
  });

  it('resume() recreates sound if OS reclaimed it', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });
    await act(async () => { await result.current.pause(); });

    // Simulate OS reclaim by nulling the sound
    (Audio.Sound.createAsync as jest.Mock).mockResolvedValue({ sound: mockSound });

    // Force sound to null by calling stop (simulating OS reclaim)
    await act(async () => { await result.current.stopPlayback(); });

    // Resume after reclaim — should recreate from audioUrl
    await act(async () => { await result.current.resume(); });

    expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(2); // initial + recreate
  });
});
