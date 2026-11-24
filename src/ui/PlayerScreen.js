import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from './TextInput.js';
import { syncBeatsClient } from '../core/syncBeatsClient.js';
import { syncEngine } from '../core/syncEngine.js';
import { authService } from '../core/authService.js';
import { trackDownloader } from '../core/trackDownloader.js';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function queueIndex(queue, selection) {
  if (!queue.length) return -1;
  const byId = queue.findIndex(item => item.id === selection.id);
  return byId >= 0 ? byId : Math.max(0, Math.min(selection.index, queue.length - 1));
}

export function PlayerScreen({ roomId: initialRoomId, onBack }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [terminalRows, setTerminalRows] = useState(stdout.rows || 24);
  const [roomState, setRoomState] = useState(null);
  const [syncStats, setSyncStats] = useState({ latency: null, offset: 0 });
  const [buffering, setBuffering] = useState(false);
  const [searchState, setSearchState] = useState('none'); // 'none', 'input', 'loading', 'results'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);
  const [driftInfo, setDriftInfo] = useState({ tier: 'measuring', expected: 0, driftMs: null });
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [queueState, setQueueState] = useState('none');
  const [queueSelection, setQueueSelection] = useState({ id: null, index: 0 });
  const queue = roomState?.queue || [];
  const queueSelectedIndex = queueIndex(queue, queueSelection);
  const visibleCount = Math.max(1, Math.min(10, terminalRows - 20));
  const queueStart = Math.max(0, Math.min(queueSelectedIndex - Math.floor(visibleCount / 2), queue.length - visibleCount));
  const visibleQueue = queue.slice(queueStart, queueStart + visibleCount);

  useEffect(() => {
    const resize = () => setTerminalRows(stdout.rows || 24);
    stdout.on('resize', resize);
    return () => stdout.off('resize', resize);
  }, [stdout]);
  useEffect(() => {
    setQueueSelection(current => {
      const index = queueIndex(queue, current), id = queue[index]?.id || null;
      return current.id === id && current.index === index ? current : { id, index };
    });
  }, [roomState?.queue]);
  
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  useEffect(() => {

    const onRoomState = state => setRoomState(state ? {
      ...state,
      queue: [...(state.queue || [])],
      participants: [...(state.participants || [])],
    } : null);
    const onStats = (stats) => setSyncStats(stats);
    const onBuffering = (isBuffering) => {
      setBuffering(isBuffering);
      if (!isBuffering) setDownloadProgress(null);
    };
    const onDrift = (info) => setDriftInfo(info);
    const onProgress = (p) => setDownloadProgress(p.progress);
    const onReady = () => setDownloadProgress(100);

    const onError = error => setError(error.message);
    syncBeatsClient.on('clientError', onError);
    syncBeatsClient.on('connectionStatus', setConnectionStatus);
    syncBeatsClient.on('roomState', onRoomState);
    syncBeatsClient.on('buffering', onBuffering);
    syncEngine.on('stats', onStats);
    syncEngine.on('drift', onDrift);
    trackDownloader.on('progress', onProgress);
    trackDownloader.on('ready', onReady);

    try { syncBeatsClient.joinRoom(initialRoomId); } catch (error) { setError(error.message); }
    return () => {
      syncBeatsClient.off('clientError', onError);
      syncBeatsClient.off('connectionStatus', setConnectionStatus);
      syncBeatsClient.disconnect();
      syncBeatsClient.off('roomState', onRoomState);
      syncBeatsClient.off('buffering', onBuffering);
      syncEngine.off('stats', onStats);
      syncEngine.off('drift', onDrift);
      trackDownloader.off('progress', onProgress);
      trackDownloader.off('ready', onReady);
    };
  }, [initialRoomId]);

  useInput((input, key) => {
    if (searchState !== 'none') {
      if (key.escape) {
        setSearchState('none');
        setSearchQuery('');
      } else if (searchState === 'results') {
        if (key.upArrow) {
          setSearchSelectedIndex(Math.max(0, searchSelectedIndex - 1));
        } else if (key.downArrow) {
          setSearchSelectedIndex(Math.min(searchResults.slice(0, 5).length - 1, searchSelectedIndex + 1));
        } else if (key.return) {
          syncBeatsClient.enqueueTrack(searchResults[searchSelectedIndex]).catch(error => setError(error.message));
          setSearchState('none');
          setSearchQuery('');
        }
      }
      return; // let TextInput handle the rest
    }

    if (input === 'q' || input === 'Q') { exit(); return; }
    if (input === 'b' || input === 'B') { onBack?.(); return; }
    if (input === 'm' || input === 'M') {
      setQueueState(current => current === 'focused' ? 'none' : 'focused');
      return;
    }
    if (key.escape && queueState === 'focused') { setQueueState('none'); return; }
    if (key.upArrow || key.downArrow) {
      setQueueState('focused');
      setQueueSelection(current => {
        const index = queueIndex(queue, current);
        if (index < 0) return { id: null, index: 0 };
        const next = Math.max(0, Math.min(queue.length - 1, index + (key.downArrow ? 1 : -1)));
        return { id: queue[next].id, index: next };
      });
      return;
    }
    if (key.return && queueState === 'focused') {
      if (queue[queueSelectedIndex]) syncBeatsClient.jumpToQueueItem(queue[queueSelectedIndex].id);
      return;
    }
    if (input === 'r' || input === 'R') {
      syncBeatsClient.toggleRepeat();
    }
    if (input === 's' || input === 'S') {
      setSearchState('input');
      setSearchResults([]);
      setSearchSelectedIndex(0);
    }
    if (input === ' ') {
      syncBeatsClient.togglePlayPause();
    }
    if (input === 'n' || input === 'N') {
      syncBeatsClient.sendControls('next');
    }
    if (input === 'p' || input === 'P') {
      syncBeatsClient.sendControls('prev');
    }
  });

  const handleSearchSubmit = async () => {
    if (searchQuery.trim()) {
      setSearchState('loading');
      try {
        const results = await syncBeatsClient.searchTracks(searchQuery);
        setSearchResults(results);
      } catch (error) { setError(error.message); setSearchResults([]); }
      setSearchSelectedIndex(0);
      setSearchState('results');
    } else {
      setSearchState('none');
      setSearchQuery('');
    }
  };

  const currentTrack = roomState?.queue?.find(q => q.isCurrent) 
    || roomState?.queue?.find(q => q.trackUrl === roomState?.trackUrl) 
    || (roomState?.trackUrl ? { title: 'Unknown Track', artist: 'Unknown', trackUrl: roomState.trackUrl } : null);

  if (!roomState) {
    return (
      <Box minHeight="100%" minWidth="100%" flexDirection="column" borderStyle="round" borderColor="cyan" justifyContent="center" alignItems="center">
        <Text color="cyan">Room {initialRoomId}: {connectionStatus}</Text>
        {error && <Text color="red">{error}</Text>}
        <Text>[B] Choose another room • [Q] Quit</Text>
      </Box>
    );
  }

  return (
    <Box minHeight="100%" minWidth="100%" flexDirection="column" borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box borderStyle="round" borderColor="green" paddingX={1} marginBottom={1} justifyContent="space-between">
        <Text bold color="greenBright">SyncBeats Terminal</Text>
        <Text color="gray">Room: {initialRoomId}</Text>
      </Box>

      <Box flexDirection="column"><Text color="gray">Connection: {connectionStatus}</Text>{error && <Text color="red">{error}</Text>}</Box>
      {/* Search Bar */}
      {searchState !== 'none' && (
        <Box paddingX={2} paddingY={1} borderStyle="single" borderColor="yellow" flexDirection="column">
          <Box>
            <Text color="yellow">🔍 Search: </Text>
            <TextInput 
              value={searchQuery} 
              onChange={setSearchQuery} 
              onSubmit={handleSearchSubmit} 
              focus={searchState === 'input'}
            />
          </Box>
          {searchState === 'loading' && <Text color="gray">Loading results...</Text>}
          {searchState === 'results' && searchResults.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" underline>Select a track (Up/Down + Enter):</Text>
              {searchResults.slice(0, 5).map((res, i) => (
                <Text key={res.videoId || res.url || i} color={i === searchSelectedIndex ? 'black' : 'white'} backgroundColor={i === searchSelectedIndex ? 'yellow' : undefined}>
                  {i === searchSelectedIndex ? '> ' : '  '}{res.title} - {res.author?.name || res.uploaderName || 'Unknown'}
                </Text>
              ))}
            </Box>
          )}
          {searchState === 'results' && searchResults.length === 0 && (
            <Text color="red">No results found.</Text>
          )}
        </Box>
      )}

      {/* Main Content Split */}
      <Box flexGrow={1} flexDirection="row">
        
        {/* Left Column - Now Playing & Queue */}
        <Box width="60%" flexDirection="column" paddingRight={2}>
          
          {/* Now Playing */}
          <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
            <Text bold color="magentaBright">Now Playing</Text>
            {currentTrack ? (
              <>
                <Text bold wrap="truncate-end">{currentTrack.title}</Text>
                <Text color="gray" wrap="truncate-end">{currentTrack.artist}</Text>
                <Box>
                  {buffering ? (
                    <Box flexDirection="column">
                      <Text color="yellow">
                        {downloadProgress === 100 
                          ? 'Waiting for other participants to sync...' 
                          : 'Downloading track...'}
                      </Text>
                      {downloadProgress !== null && downloadProgress < 100 && (
                        <Box marginTop={1} flexDirection="row" alignItems="center">
                          <Text color="cyan">{downloadProgress}% </Text>
                          <Text color="gray">
                            [{'▬'.repeat(Math.floor(downloadProgress / 100 * 20))}{' '.repeat(20 - Math.floor(downloadProgress / 100 * 20))}]
                          </Text>
                        </Box>
                      )}
                    </Box>
                  ) : (
                    <Box flexDirection="column">
                      <Text color={roomState?.state?.toUpperCase() === 'PLAYING' ? 'green' : 'yellow'}>
                        {roomState?.state?.toUpperCase() === 'PLAYING' ? '> Playing' : '|| Paused'}
                      </Text>
                      <Box flexDirection="row" alignItems="center">
                        <Text color="cyan">{formatTime(driftInfo.expected)} </Text>
                        <Text color="gray"> (Duration unknown)</Text>
                      </Box>
                    </Box>
                  )}
                </Box>
              </>
            ) : (
              <Text color="gray">Nothing playing</Text>
            )}
          </Box>

          {/* Queue */}
          <Box borderStyle="round" borderColor={queueState === 'focused' ? 'cyan' : 'blue'} paddingX={1} flexDirection="column" flexGrow={1} marginTop={1}>
            <Text bold color={queueState === 'focused' ? 'cyanBright' : 'blueBright'}>
              Queue{queue.length ? ` (${queueSelectedIndex + 1}/${queue.length})` : ''}
            </Text>
            {visibleQueue.map((q, offset) => {
              const index = queueStart + offset, selected = queueState === 'focused' && index === queueSelectedIndex;
              return <Text key={q.id} wrap="truncate-end" inverse={selected} bold={selected} color={selected || q.isCurrent ? 'cyan' : 'white'}>
                {selected ? '> ' : '  '}{index + 1}. {q.title} {q.isCurrent ? '←' : ''}
              </Text>;
            })}
            {!queue.length && <Text color="gray">Queue is empty. Press S to add music.</Text>}
          </Box>
        </Box>

        {/* Right Column - Participants & Stats */}
        <Box width="40%" flexDirection="column">
          
          {/* Participants */}
          <Box borderStyle="round" borderColor="green" padding={1} flexDirection="column" flexBasis="50%">
            <Text bold color="greenBright">Participants</Text>
            {(roomState?.participants || []).map((p) => (
              <Text key={p.socketId}>
                🟢 {p.displayName} {p.userId === authService.getUser()?.id ? '(you)' : ''}
              </Text>
            ))}
          </Box>

          {/* Sync Stats */}
          <Box borderStyle="round" borderColor="yellow" padding={1} flexDirection="column" marginTop={1} height={6}>
            <Text bold color="yellowBright">Sync Status</Text>
            <Text>{syncStats.latency == null ? 'Measuring latency...' : `${Math.round(syncStats.latency)}ms Latency`}</Text>
            <Text>Drift: {driftInfo.tier}{driftInfo.driftMs == null ? '' : ` (${Math.round(driftInfo.driftMs)}ms)`}</Text>
          </Box>
        </Box>
      </Box>

      {/* Footer Controls */}
      <Box marginTop={1} justifyContent="center">
        <Text color="gray">
          {queueState === 'focused'
            ? '[↑/↓] Move • [Enter] Play • [M/Esc] Done • [Space] Play/Pause • [Q] Quit'
            : '[Space] Play/Pause • [N/P] Skip • [S] Search • [M] Queue • [Q] Quit'}
        </Text>
      </Box>
    </Box>
  );
}
