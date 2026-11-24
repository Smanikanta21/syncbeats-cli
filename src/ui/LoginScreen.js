import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from './TextInput.js';
import Spinner from 'ink-spinner';
import { authService } from '../core/authService.js';
import { browserLogin } from '../core/browserAuth.js';

export function LoginScreen({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [otp, setOtp] = useState('');
  const [activeField, setActiveField] = useState('email'), [error, setError] = useState(null), [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false), browserController = useRef(null);
  useEffect(() => () => browserController.current?.abort(), []);
  const fields = mode === 'login'
    ? [{ name: 'email', label: 'Email', value: email, set: setEmail }, { name: 'password', label: 'Password', value: password, set: setPassword, mask: '*' }]
    : mode === 'signup'
      ? [{ name: 'name', label: 'Name', value: name, set: setName }, { name: 'email', label: 'Email', value: email, set: setEmail }, { name: 'password', label: 'Password', value: password, set: setPassword, mask: '*' }]
      : mode === 'forgot_password'
        ? [{ name: 'email', label: 'Email', value: email, set: setEmail }]
        : [{ name: 'otp', label: 'OTP', value: otp, set: setOtp }, { name: 'password', label: 'New Password', value: password, set: setPassword, mask: '*' }];
  const changeMode = next => {
    setMode(next); setActiveField(next === 'signup' ? 'name' : 'email');
    setError(null); setMessage(null); setPassword(''); setOtp('');
  };
  useInput((input, key) => {
    if (loading) { if (key.escape) browserController.current?.abort(); return; }
    if (key.tab) {
      const index = fields.findIndex(f => f.name === activeField);
      setActiveField(fields[(index + (key.shift ? fields.length - 1 : 1)) % fields.length].name);
    } else if (key.ctrl && input === 't') changeMode(mode === 'login' ? 'signup' : 'login');
    else if (key.ctrl && input === 'f') changeMode('forgot_password');
    else if (key.ctrl && input === 'g') signInBrowser();
  });
  const signInBrowser = async () => {
    if (busy.current) return; busy.current = true; setLoading(true); setError(null);
    setMessage('Finish sign-in in your browser. Esc cancels.');
    browserController.current = new AbortController();
    try { await browserLogin({ signal: browserController.current.signal }); onLoginSuccess(); }
    catch (error) { setError(error.message); }
    finally { browserController.current = null; busy.current = false; setLoading(false); }
  };
  const submit = async () => {
    if (busy.current) return;
    setError(null); setMessage(null);
    if (fields.some(f => !f.value.trim())) { setError('Complete all fields first.'); return; }
    busy.current = true; setLoading(true);
    try {
      if (mode === 'login') { await authService.login(email.trim(), password); onLoginSuccess(); }
      else if (mode === 'signup') {
        await authService.register(name.trim(), email.trim(), password);
        changeMode('login'); setMessage('Check your email to verify your account, then sign in here.');
      } else if (mode === 'forgot_password') {
        await authService.forgotPassword(email.trim()); setMode('reset'); setActiveField('otp');
        setMessage('Enter the code from your email and a new password.');
      } else {
        await authService.resetPasswordWithOtp(email.trim(), otp.trim(), password);
        await authService.login(email.trim(), password); onLoginSuccess();
      }
    } catch (error) {
      if (error.message.includes('GOOGLE_AUTH_SETUP_PASSWORD')) {
        setMode('reset'); setActiveField('otp'); setPassword('');
        setMessage('Use the emailed OTP to set a password for your Google account.');
      } else if (error.message.includes('UNVERIFIED_EMAIL')) setError('Verify the link in your email before signing in.');
      else setError(error.message);
    } finally { busy.current = false; setLoading(false); }
  };
  return (
    <Box minHeight="100%" minWidth="100%" justifyContent="center" alignItems="center" flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={4} paddingY={2} flexDirection="column">
        <Box justifyContent="center" marginBottom={1}><Text bold color="cyanBright">{mode === 'login' ? 'SyncBeats Login' : mode === 'signup' ? 'SyncBeats Sign Up' : mode === 'forgot_password' ? 'Forgot Password' : 'Reset Password'}</Text></Box>
        {message && <Box marginY={1} width={54}><Text color="greenBright">{message}</Text></Box>}
        {fields.map((field, index) => (
          <Box key={field.name} marginY={1}>
            <Box width={15}><Text color={activeField === field.name ? 'cyan' : 'white'}>{field.label}:</Text></Box>
            <TextInput value={field.value} onChange={field.set} focus={!loading && activeField === field.name} mask={field.mask}
              onSubmit={() => index + 1 < fields.length ? setActiveField(fields[index + 1].name) : submit()} />
          </Box>
        ))}
        <Box marginTop={2} flexDirection="column" alignItems="center">
          <Text color="gray">[Tab] switch fields • [Enter] next / submit</Text>
          <Text color="gray">[Ctrl+T] Login / Signup • [Ctrl+F] Password reset</Text>
          <Text color="gray">[Ctrl+G] Browser sign-in</Text>
        </Box>
        {error && <Box marginTop={1} width={54}><Text color="redBright">{error}</Text></Box>}
        {loading && <Box marginTop={1}><Text color="blueBright"><Spinner type="dots" /> Processing...</Text></Box>}
      </Box>
    </Box>
  );
}
