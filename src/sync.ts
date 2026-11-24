import type { LyricLine } from './data/carols';

/**
 * Returns the index of the active lyric line for a playback position (in seconds).
 * Returns -1 when lyrics are empty or playback hasn't reached the first timestamp.
 */
export function findActiveLineIndex(lyrics: LyricLine[], currentTimeSec: number): number {
  if (!lyrics.length || currentTimeSec < lyrics[0].time) return -1;
  let active = 0;
  for (let i = 0; i < lyrics.length; i++) {
    if (currentTimeSec >= lyrics[i].time) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const wavCache = new Map<string, string>();

// shortcut: 8kHz mono PCM synthesis in memory for previewing up to ~60s melodies, replace with real audioUri mp3/m4a tracks when adding full carol recordings
export function buildMelodyWavDataUri(id: string, notes: [number, number][], totalDurationSec: number): string {
  const cached = wavCache.get(id);
  if (cached) return cached;

  const sampleRate = 8000;
  const totalSamples = Math.max(1, Math.floor(totalDurationSec * sampleRate));
  const dataSize = totalSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let cursor = 0;
  for (let n = 0; n < notes.length && cursor < totalSamples; n++) {
    const [freq, dur] = notes[n];
    const noteSamples = Math.min(totalSamples - cursor, Math.floor(dur * sampleRate));
    for (let i = 0; i < noteSamples; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, i / (sampleRate * 0.04));
      const release = Math.min(1, (noteSamples - i) / (sampleRate * 0.08));
      const env = attack * release;
      // Warm organ-like harmonic blend
      const wave =
        0.65 * Math.sin(2 * Math.PI * freq * t) +
        0.25 * Math.sin(2 * Math.PI * freq * 2 * t) +
        0.1 * Math.sin(2 * Math.PI * freq * 3 * t);
      const sample = Math.max(-1, Math.min(1, wave * env * 0.35));
      view.setInt16(44 + (cursor + i) * 2, Math.floor(sample * 32767), true);
    }
    cursor += noteSamples;
    if (n === notes.length - 1 && cursor < totalSamples) {
      n = -1; // Repeat melody loop gently until totalDurationSec finishes
    }
  }

  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    b64 += chars[b0 >> 2];
    b64 += chars[((b0 & 3) << 4) | (b1 >> 4)];
    b64 += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    b64 += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }

  const uri = `data:audio/wav;base64,${b64}`;
  wavCache.set(id, uri);
  return uri;
}
