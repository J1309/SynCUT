import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { StatusBar } from 'expo-status-bar';
import { CAROLS, Carol } from './src/data/carols';
import { buildMelodyWavDataUri, findActiveLineIndex, formatTime } from './src/sync';

const SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: "'Instrument Serif', 'Playfair Display', 'Newsreader', Georgia, serif",
});

const SANS_FONT = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: "'Geist Sans', 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif",
});

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: "'Geist Mono', 'SF Mono', 'JetBrains Mono', monospace",
});

export default function App() {
  const [screen, setScreen] = useState<'select' | 'karaoke'>('select');
  const [selectedCarol, setSelectedCarol] = useState<Carol>(CAROLS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(CAROLS[0].duration);
  const [lyricFontSize, setLyricFontSize] = useState(26);
  const [viewportHeight, setViewportHeight] = useState(440);
  const [searchQuery, setSearchQuery] = useState('');
  const [vocalRemoved, setVocalRemoved] = useState(true);

  const soundRef = useRef<Audio.Sound | null>(null);
  const loadedCarolIdRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const lyricsScrollRef = useRef<ScrollView | null>(null);
  const lineLayoutsRef = useRef<Record<number, { y: number; height: number }>>({});
  const progressBarWidthRef = useRef(1);

  const activeLineIndex = findActiveLineIndex(selectedCarol.lyrics, positionSec);
  const selectedCarolIndex = CAROLS.findIndex((c) => c.id === selectedCarol.id);

  // Mobile-native + Emil Kowalski custom easing & editorial web baseline
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    let viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) {
      viewportMeta = document.createElement('meta');
      viewportMeta.setAttribute('name', 'viewport');
      document.head.appendChild(viewportMeta);
    }
    viewportMeta.setAttribute(
      'content',
      'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'
    );

    let themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeMeta);
    }
    themeMeta.setAttribute('content', '#F6F5F0');

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      :root {
        --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
      }
      html, body, #root {
        height: 100dvh;
        background-color: #F6F5F0;
        overscroll-behavior: none;
        -webkit-tap-highlight-color: transparent;
        -webkit-text-size-adjust: 100%;
        -webkit-font-smoothing: antialiased;
      }
      input, textarea {
        font-size: 16px !important;
        outline: none;
      }
      [role="button"] {
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), opacity 150ms cubic-bezier(0.23, 1, 0.32, 1);
      }
    `;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, []);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    }).catch(() => {});
    loadCarolTrack(CAROLS[0], false);
    return () => {
      loadTokenRef.current += 1;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // 80ms status loop keeps lyrics tightly locked to the audio clock
  useEffect(() => {
    const timer = setInterval(async () => {
      const sound = soundRef.current;
      if (!sound) return;
      try {
        const status = await sound.getStatusAsync();
        if (!status.isLoaded) return;
        setPositionSec(status.positionMillis / 1000);
        if (status.durationMillis && status.durationMillis > 0) {
          setDurationSec(status.durationMillis / 1000);
        }
        setIsPlaying(status.isPlaying);
      } catch {}
    }, 80);
    return () => clearInterval(timer);
  }, []);

  function scrollToLine(index: number, animated = true) {
    if (index < 0) return;
    const layout = lineLayoutsRef.current[index];
    if (layout && lyricsScrollRef.current) {
      const targetY = Math.max(0, layout.y - viewportHeight / 2 + layout.height / 2);
      lyricsScrollRef.current.scrollTo({ y: targetY, animated });
    }
  }

  useEffect(() => {
    if (screen !== 'karaoke' || activeLineIndex < 0) return;
    scrollToLine(activeLineIndex, true);
  }, [activeLineIndex, screen, viewportHeight]);

  async function loadCarolTrack(
    carol: Carol,
    autoPlay: boolean,
    useKaraoke = vocalRemoved,
    startSec = 0
  ) {
    const token = ++loadTokenRef.current;
    if (startSec === 0) {
      lineLayoutsRef.current = {};
      setPositionSec(0);
    }
    setDurationSec(carol.duration);

    if (soundRef.current) {
      const prev = soundRef.current;
      soundRef.current = null;
      loadedCarolIdRef.current = null;
      await prev.unloadAsync().catch(() => {});
    }

    try {
      const chosenUri = useKaraoke && carol.karaokeUri ? carol.karaokeUri : carol.audioUri;
      const source =
        typeof chosenUri === 'number'
          ? chosenUri
          : chosenUri
            ? { uri: chosenUri }
            : {
                uri: buildMelodyWavDataUri(
                  carol.id,
                  carol.melodyNotes ?? [[440, 1]],
                  carol.duration
                ),
              };

      const { sound } = await Audio.Sound.createAsync(
        source,
        {
          shouldPlay: false,
          positionMillis: Math.floor(startSec * 1000),
          progressUpdateIntervalMillis: 60,
        },
        (status: AVPlaybackStatus) => {
          if (!status.isLoaded || token !== loadTokenRef.current) return;
          setPositionSec(status.positionMillis / 1000);
          if (status.durationMillis && status.durationMillis > 0) {
            setDurationSec(status.durationMillis / 1000);
          }
          setIsPlaying(status.isPlaying);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionSec(0);
            sound.setPositionAsync(0).catch(() => {});
          }
        }
      );

      if (token !== loadTokenRef.current) {
        await sound.unloadAsync().catch(() => {});
        return;
      }

      soundRef.current = sound;
      loadedCarolIdRef.current = `${carol.id}:${useKaraoke ? 'k' : 'v'}`;

      if (startSec > 0) {
        await sound.setPositionAsync(Math.floor(startSec * 1000)).catch(() => {});
      }

      if (autoPlay) {
        await sound.playAsync().catch(() => {});
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    } catch {
      if (token === loadTokenRef.current) {
        setIsPlaying(false);
      }
    }
  }

  async function togglePlayPause() {
    const sound = soundRef.current;
    const expectedKey = `${selectedCarol.id}:${vocalRemoved ? 'k' : 'v'}`;
    if (!sound || loadedCarolIdRef.current !== expectedKey) {
      await loadCarolTrack(selectedCarol, true, vocalRemoved, positionSec);
      return;
    }
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) {
        await loadCarolTrack(selectedCarol, true, vocalRemoved, positionSec);
        return;
      }
      if (status.isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        await sound.playAsync();
        setIsPlaying(true);
      }
    } catch {}
  }

  async function toggleVocalMode() {
    const nextMode = !vocalRemoved;
    setVocalRemoved(nextMode);
    await loadCarolTrack(selectedCarol, isPlaying, nextMode, positionSec);
  }

  async function seekToSeconds(targetSec: number) {
    const clamped = Math.max(0, Math.min(durationSec, targetSec));
    setPositionSec(clamped);
    if (soundRef.current) {
      await soundRef.current.setPositionAsync(Math.floor(clamped * 1000)).catch(() => {});
    }
  }

  async function openCarolInKaraoke(carol: Carol) {
    const expectedKey = `${carol.id}:${vocalRemoved ? 'k' : 'v'}`;
    const isSameLoaded =
      carol.id === selectedCarol.id &&
      loadedCarolIdRef.current === expectedKey &&
      soundRef.current !== null;
    setSelectedCarol(carol);
    setScreen('karaoke');
    if (isSameLoaded) {
      if (!isPlaying) {
        await soundRef.current?.playAsync().catch(() => {});
        setIsPlaying(true);
      }
    } else {
      await loadCarolTrack(carol, true, vocalRemoved, 0);
    }
  }

  async function stepCarol(direction: -1 | 1) {
    const currentIndex = CAROLS.findIndex((c) => c.id === selectedCarol.id);
    const nextCarol = CAROLS[(currentIndex + direction + CAROLS.length) % CAROLS.length];
    setSelectedCarol(nextCarol);
    await loadCarolTrack(nextCarol, true, vocalRemoved, 0);
  }

  const visibleCarols = CAROLS.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.subtitle.toLowerCase().includes(q) ||
      c.lyrics.some(
        (l) =>
          l.text.toLowerCase().includes(q) ||
          (l.translit && l.translit.toLowerCase().includes(q))
      )
    );
  });

  const progressRatio = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        {/* SCREEN 1: EDITORIAL INDEX / SONG SELECTION */}
        {screen === 'select' && (
          <View style={styles.selectScreen}>
            <View style={styles.editorialColumn}>
              {/* Editorial Masthead */}
              <View style={styles.masthead}>
                <View style={styles.mastheadMetaRow}>
                  <Text style={styles.mastheadTag}>EDITION 01 / HYMNAL INDEX</Text>
                  <View style={styles.pastelBadge}>
                    <Text style={styles.pastelBadgeText}>
                      {String(CAROLS.length).padStart(2, '0')} WORKS
                    </Text>
                  </View>
                </View>
                <Text style={styles.editorialDisplayTitle}>Carols.</Text>
              </View>

              {/* Minimal Hairline Filter */}
              <View style={styles.searchLineBox}>
                <Text style={styles.searchPrefix}>INDEX /</Text>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Filter by title or lyric..."
                  placeholderTextColor="#9C9A92"
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <Pressable
                    role="button"
                    hitSlop={12}
                    onPress={() => setSearchQuery('')}
                    style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.clearBtnText}>CLEAR</Text>
                  </Pressable>
                )}
              </View>

              {/* Editorial Track Table */}
              <ScrollView
                style={styles.songList}
                contentContainerStyle={styles.songListContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {visibleCarols.map((carol) => {
                  const idx = CAROLS.findIndex((c) => c.id === carol.id);
                  const isCurrent = carol.id === selectedCarol.id && isPlaying;
                  return (
                    <Pressable
                      key={carol.id}
                      role="button"
                      onPress={() => openCarolInKaraoke(carol)}
                      style={({ pressed }) => [
                        styles.editorialRow,
                        isCurrent && styles.editorialRowActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.rowIndexNum,
                          isCurrent && styles.rowIndexNumActive,
                        ]}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </Text>

                      <View style={styles.songTitleCol}>
                        <Text style={styles.songRowTitle} numberOfLines={1}>
                          {carol.title}
                        </Text>
                        <Text style={styles.songRowSub} numberOfLines={1}>
                          {carol.subtitle}
                        </Text>
                      </View>

                      <View style={styles.songRowRight}>
                        <Text style={styles.songDuration}>{formatTime(carol.duration)}</Text>
                        <View
                          style={[
                            styles.rowActionBox,
                            isCurrent && styles.rowActionBoxActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.rowActionText,
                              isCurrent && styles.rowActionTextActive,
                            ]}
                          >
                            {isCurrent ? 'LIVE' : 'SING'}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Editorial Now-Playing Bar when returning to Index */}
              {(isPlaying || positionSec > 0) && (
                <Pressable
                  role="button"
                  onPress={() => setScreen('karaoke')}
                  style={({ pressed }) => [styles.resumeStrip, pressed && styles.pressed]}
                >
                  <View style={styles.resumeLeft}>
                    <Text style={styles.resumeIndex}>
                      NO. {String(selectedCarolIndex + 1).padStart(2, '0')}
                    </Text>
                    <Text style={styles.resumeTitle} numberOfLines={1}>
                      {selectedCarol.title}
                    </Text>
                  </View>
                  <Text style={styles.resumeCta}>STAGE →</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* SCREEN 2: EDITORIAL KARAOKE STAGE */}
        {screen === 'karaoke' && (
          <View style={styles.karaokeScreen}>
            {/* Top Architectural Hairline Bar */}
            <View style={styles.topBar}>
              <Pressable
                role="button"
                hitSlop={10}
                onPress={() => setScreen('select')}
                style={({ pressed }) => [styles.navBoxBtn, pressed && styles.pressed]}
              >
                <Text style={styles.navBoxBtnText}>← INDEX</Text>
              </Pressable>

              <View style={styles.topCenterMeta}>
                <Text style={styles.topCatalogNum}>
                  NO. {String(selectedCarolIndex + 1).padStart(2, '0')}
                </Text>
                <Text style={styles.karaokeTitle} numberOfLines={1}>
                  {selectedCarol.title}
                </Text>
              </View>

              <View style={styles.topActions}>
                <Pressable
                  role="button"
                  hitSlop={8}
                  onPress={toggleVocalMode}
                  style={({ pressed }) => [
                    styles.modeBadgeBtn,
                    vocalRemoved && styles.modeBadgeBtnActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBadgeText,
                      vocalRemoved && styles.modeBadgeTextActive,
                    ]}
                  >
                    {vocalRemoved ? 'NO VOCAL' : 'VOCAL'}
                  </Text>
                </Pressable>

                <Pressable
                  role="button"
                  hitSlop={8}
                  onPress={() => setLyricFontSize((s) => Math.max(20, s - 2))}
                  style={({ pressed }) => [styles.sizeBoxBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.sizeBoxText}>A-</Text>
                </Pressable>

                <Pressable
                  role="button"
                  hitSlop={8}
                  onPress={() => setLyricFontSize((s) => Math.min(38, s + 2))}
                  style={({ pressed }) => [styles.sizeBoxBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.sizeBoxText}>A+</Text>
                </Pressable>
              </View>
            </View>

            {/* Centered Editorial Karaoke Lyrics Stage */}
            <ScrollView
              ref={lyricsScrollRef}
              style={styles.lyricsScroll}
              contentContainerStyle={[
                styles.lyricsScrollContent,
                { paddingVertical: Math.max(100, Math.round(viewportHeight * 0.32)) },
              ]}
              showsVerticalScrollIndicator={false}
              onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
            >
              {selectedCarol.lyrics.map((line, index) => {
                const isCurrent = index === activeLineIndex;
                const isPast = activeLineIndex > index;
                return (
                  <Pressable
                    key={`${selectedCarol.id}-${index}`}
                    role="button"
                    onLayout={(e) => {
                      lineLayoutsRef.current[index] = {
                        y: e.nativeEvent.layout.y,
                        height: e.nativeEvent.layout.height,
                      };
                      if (index === activeLineIndex) {
                        scrollToLine(index, true);
                      }
                    }}
                    onPress={() => seekToSeconds(line.time)}
                    style={({ pressed }) => [
                      styles.lyricLineWrap,
                      isCurrent && styles.lyricLineWrapCurrent,
                      pressed && styles.pressed,
                    ]}
                  >
                    {isCurrent && (
                      <View style={styles.activeMarkerPill}>
                        <Text style={styles.activeMarkerText}>
                          {formatTime(line.time)}
                        </Text>
                      </View>
                    )}

                    <Text
                      style={[
                        styles.lyricLineText,
                        {
                          fontSize: isCurrent ? lyricFontSize + 2 : lyricFontSize - 2,
                          lineHeight: Math.round(
                            (isCurrent ? lyricFontSize + 2 : lyricFontSize - 2) * 1.32
                          ),
                        },
                        isPast && styles.lyricLineTextPast,
                        isCurrent && styles.lyricLineTextCurrent,
                      ]}
                    >
                      {line.text}
                    </Text>

                    {line.translit ? (
                      <Text
                        style={[
                          styles.lyricTranslitText,
                          {
                            fontSize: isCurrent
                              ? Math.max(18, Math.round(lyricFontSize * 0.82))
                              : Math.max(15, Math.round(lyricFontSize * 0.68)),
                            lineHeight: Math.round(
                              (isCurrent
                                ? Math.max(18, Math.round(lyricFontSize * 0.82))
                                : Math.max(15, Math.round(lyricFontSize * 0.68))) * 1.32
                            ),
                          },
                          isPast && styles.lyricTranslitTextPast,
                          isCurrent && styles.lyricTranslitTextCurrent,
                        ]}
                      >
                        {line.translit}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Bottom Architectural Transport Dock */}
            <View style={styles.karaokeDock}>
              <View style={styles.dockColumn}>
                {/* Hairline Scrubber */}
                <Pressable
                  role="button"
                  onLayout={(e) => {
                    progressBarWidthRef.current = Math.max(1, e.nativeEvent.layout.width);
                  }}
                  onPress={(e) => {
                    const x = e.nativeEvent.locationX;
                    const ratio = Math.max(0, Math.min(1, x / progressBarWidthRef.current));
                    seekToSeconds(ratio * durationSec);
                  }}
                  style={styles.scrubberHitArea}
                >
                  <View style={styles.scrubberTrack}>
                    <View style={[styles.scrubberFill, { width: `${progressRatio * 100}%` }]} />
                  </View>
                </Pressable>

                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(positionSec)}</Text>
                  <Text style={styles.timeCenterLabel}>
                    {selectedCarol.subtitle.toUpperCase()}
                  </Text>
                  <Text style={styles.timeText}>{formatTime(durationSec)}</Text>
                </View>

                <View style={styles.controlsRow}>
                  <Pressable
                    role="button"
                    hitSlop={10}
                    onPress={() => seekToSeconds(0)}
                    style={({ pressed }) => [styles.secondaryBoxBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBoxText}>RESTART</Text>
                  </Pressable>

                  <Pressable
                    role="button"
                    hitSlop={10}
                    onPress={() => stepCarol(-1)}
                    style={({ pressed }) => [styles.secondaryBoxBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBoxText}>PREV</Text>
                  </Pressable>

                  <Pressable
                    role="button"
                    hitSlop={10}
                    onPress={togglePlayPause}
                    style={({ pressed }) => [styles.primaryPlayBox, pressed && styles.pressed]}
                  >
                    <Text style={styles.primaryPlayText}>
                      {isPlaying ? 'PAUSE' : 'PLAY'}
                    </Text>
                  </Pressable>

                  <Pressable
                    role="button"
                    hitSlop={10}
                    onPress={() => stepCarol(1)}
                    style={({ pressed }) => [styles.secondaryBoxBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBoxText}>NEXT</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F5F0',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#F6F5F0',
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },

  /* Screen 1: Editorial Index Selection */
  selectScreen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    alignItems: 'center',
  },
  editorialColumn: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
  },
  masthead: {
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    marginBottom: 16,
  },
  mastheadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  mastheadTag: {
    color: '#787670',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  pastelBadge: {
    backgroundColor: '#FBF3DB',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pastelBadgeText: {
    color: '#8F5E00',
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  editorialDisplayTitle: {
    color: '#111111',
    fontFamily: SERIF_FONT,
    fontSize: 52,
    fontWeight: '400',
    letterSpacing: -1.6,
    lineHeight: 56,
  },

  /* Hairline Search Filter */
  searchLineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E4E2DA',
    height: 46,
    marginBottom: 8,
  },
  searchPrefix: {
    color: '#787670',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#111111',
    fontFamily: SANS_FONT,
    fontSize: 16,
    height: '100%',
  },
  clearBtn: {
    paddingLeft: 12,
    paddingVertical: 6,
  },
  clearBtnText: {
    color: '#111111',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  /* Editorial Song List */
  songList: {
    flex: 1,
  },
  songListContent: {
    paddingBottom: 32,
  },
  editorialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E2DA',
  },
  editorialRowActive: {
    backgroundColor: '#EFECE3',
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  rowIndexNum: {
    width: 36,
    color: '#8C8A82',
    fontFamily: SERIF_FONT,
    fontStyle: 'italic',
    fontSize: 18,
  },
  rowIndexNumActive: {
    color: '#111111',
    fontWeight: '700',
  },
  songTitleCol: {
    flex: 1,
    paddingRight: 14,
  },
  songRowTitle: {
    color: '#111111',
    fontFamily: SANS_FONT,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  songRowSub: {
    color: '#787670',
    fontFamily: SERIF_FONT,
    fontStyle: 'italic',
    fontSize: 14,
    marginTop: 3,
  },
  songRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  songDuration: {
    color: '#787670',
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  rowActionBox: {
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 5,
  },
  rowActionBoxActive: {
    backgroundColor: '#FBF3DB',
    borderWidth: 1,
    borderColor: '#D8C383',
  },
  rowActionText: {
    color: '#FFFFFF',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  rowActionTextActive: {
    color: '#8F5E00',
  },

  /* Bottom Resume Strip on Index */
  resumeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111111',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 6,
    marginBottom: 20,
  },
  resumeLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 12,
  },
  resumeIndex: {
    color: '#A3A19A',
    fontFamily: MONO_FONT,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  resumeTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontFamily: SANS_FONT,
    fontSize: 15,
    fontWeight: '600',
  },
  resumeCta: {
    color: '#FBF3DB',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  /* Screen 2: Editorial Karaoke Stage */
  karaokeScreen: {
    flex: 1,
    backgroundColor: '#F6F5F0',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E2DA',
    backgroundColor: '#FBFBF9',
    gap: 10,
  },
  navBoxBtn: {
    borderWidth: 1,
    borderColor: '#DCD9D0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 5,
  },
  navBoxBtnText: {
    color: '#111111',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  topCenterMeta: {
    flex: 1,
    alignItems: 'center',
  },
  topCatalogNum: {
    color: '#8C8A82',
    fontFamily: MONO_FONT,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  karaokeTitle: {
    color: '#111111',
    fontFamily: SANS_FONT,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeBadgeBtn: {
    borderWidth: 1,
    borderColor: '#DCD9D0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 5,
  },
  modeBadgeBtnActive: {
    backgroundColor: '#FBF3DB',
    borderColor: '#E2CE94',
  },
  modeBadgeText: {
    color: '#787670',
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  modeBadgeTextActive: {
    color: '#8F5E00',
  },
  sizeBoxBtn: {
    borderWidth: 1,
    borderColor: '#DCD9D0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 5,
  },
  sizeBoxText: {
    color: '#111111',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
  },

  /* Centered Lyrics Canvas */
  lyricsScroll: {
    flex: 1,
  },
  lyricsScrollContent: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  lyricLineWrap: {
    width: '100%',
    maxWidth: 640,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderRadius: 8,
  },
  lyricLineWrapCurrent: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#111111',
    paddingVertical: 18,
    marginVertical: 6,
  },
  activeMarkerPill: {
    backgroundColor: '#FBF3DB',
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 999,
    marginBottom: 6,
  },
  activeMarkerText: {
    color: '#8F5E00',
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  lyricLineText: {
    color: 'rgba(17, 17, 17, 0.28)',
    fontFamily: SANS_FONT,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  lyricLineTextPast: {
    color: 'rgba(17, 17, 17, 0.14)',
  },
  lyricLineTextCurrent: {
    color: '#111111',
    fontWeight: '800',
  },
  lyricTranslitText: {
    color: 'rgba(17, 17, 17, 0.30)',
    fontFamily: SANS_FONT,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  lyricTranslitTextPast: {
    color: 'rgba(17, 17, 17, 0.14)',
  },
  lyricTranslitTextCurrent: {
    color: '#8F5E00',
    fontWeight: '800',
  },

  /* Bottom Architectural Transport Dock */
  karaokeDock: {
    backgroundColor: '#FBFBF9',
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#E4E2DA',
    alignItems: 'center',
  },
  dockColumn: {
    width: '100%',
    maxWidth: 640,
  },
  scrubberHitArea: {
    paddingVertical: 10,
  },
  scrubberTrack: {
    height: 3,
    backgroundColor: '#E2E0D8',
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#111111',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -2,
    marginBottom: 14,
  },
  timeText: {
    color: '#787670',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  timeCenterLabel: {
    color: '#9C9A92',
    fontFamily: MONO_FONT,
    fontSize: 10,
    letterSpacing: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryBoxBtn: {
    borderWidth: 1,
    borderColor: '#DCD9D0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBoxText: {
    color: '#111111',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  primaryPlayBox: {
    backgroundColor: '#111111',
    paddingHorizontal: 28,
    height: 40,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPlayText: {
    color: '#FFFFFF',
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
});
