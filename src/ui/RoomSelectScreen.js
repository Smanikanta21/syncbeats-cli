import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from './TextInput.js';
import { syncBeatsClient } from '../core/syncBeatsClient.js';
export function RoomSelectScreen({ onJoin }) {
  const [roomId, setRoomId] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState(null);
  const busy = useRef(false);
  const submit = async () => {
    if (busy.current) return; busy.current = true; setLoading(true); setError(null);
    try {
      const code = roomId.trim() || await syncBeatsClient.getDefaultRoom();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(code)) throw new Error('Enter a valid room code.');
      await syncBeatsClient.createRoom(code); onJoin(code);
    } catch (error) { setError(error.message); }
    finally { busy.current = false; setLoading(false); }
  };
  return (
    <Box minHeight="100%" minWidth="100%" justifyContent="center" alignItems="center">
      <Box borderStyle="round" borderColor="cyan" paddingX={4} paddingY={2} flexDirection="column">
        <Text bold color="cyanBright">Join a Room</Text>
        <Box marginY={1}><Text>Room Code: </Text><TextInput value={roomId} onChange={setRoomId} focus={!loading} onSubmit={submit} /></Box>
        <Text color="gray">{loading ? 'Loading your room...' : 'Enter a code, or leave blank for your own room.'}</Text>
        {error && <Box marginTop={1} width={54}><Text color="red">{error}</Text></Box>}
      </Box>
    </Box>
  );
}
