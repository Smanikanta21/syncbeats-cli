import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SplashScreen } from './SplashScreen.js';
import { LoginScreen } from './LoginScreen.js';
import { RoomSelectScreen } from './RoomSelectScreen.js';
import { PlayerScreen } from './PlayerScreen.js';
import { authService } from '../core/authService.js';
export function App() {
  const [stage, setStage] = useState('splash'), [roomId, setRoomId] = useState('');
  const [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (stage !== 'auth-check') return;
    let active = true; setError(null);
    authService.getMe().then(user => { if (active) setStage(user ? 'room-select' : 'auth'); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [stage, attempt]);
  useInput(input => {
    if (error && input.toLowerCase() === 'r') setAttempt(value => value + 1);
    if (error && input.toLowerCase() === 'l') { authService.logout(); setStage('auth'); setError(null); }
  }, { isActive: stage === 'auth-check' });
  if (stage === 'splash') return <SplashScreen onComplete={() => setStage('auth-check')} />;
  if (stage === 'auth-check') return <Box flexDirection="column" alignItems="center"><Text color={error ? 'red' : 'cyan'}>{error || 'Checking authentication...'}</Text>{error && <Text>[R] Retry • [L] Return to login</Text>}</Box>;
  if (stage === 'auth') return <LoginScreen onLoginSuccess={() => setStage('room-select')} />;
  if (stage === 'room-select') return <RoomSelectScreen onJoin={id => { setRoomId(id); setStage('player'); }} />;
  return <PlayerScreen roomId={roomId} onBack={() => setStage('room-select')} />;
}
