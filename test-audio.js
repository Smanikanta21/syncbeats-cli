import { once } from 'node:events';
import { AudioEngine } from './src/core/audioEngine.js';
const file = process.argv[2];
if (!file) {
  console.error('Usage: node test-audio.js /path/to/audio.m4a'); process.exitCode = 1;
} else {
  const audio = new AudioEngine();
  process.once('SIGINT', () => { audio.stop(); process.exitCode = 130; });
  try { const finished = once(audio, 'ended'); audio.play(file); await finished; console.log('Audio playback completed.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { audio.stop(); }
}
