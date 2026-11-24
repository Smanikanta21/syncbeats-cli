import { readdir, stat } from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { CACHE_DIR } from '../core/config.js';

/**
 * Reads the local music directory and returns an array of available audio tracks.
 * 
 * @param {string} dirPath - The relative or absolute path to the music directory.
 * @returns {Promise<Array<{name: string, filename: string, path: string}>>}
 */
export async function getMusicFiles(dirPath = path.join(CACHE_DIR, 'music')) {
  const musicDir = path.resolve(process.cwd(), dirPath);
  
  // Ensure the directory exists
  if (!existsSync(musicDir)) {
    mkdirSync(musicDir, { recursive: true });
    return [];
  }

  try {
    const files = await readdir(musicDir);
    const audioFiles = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      
      // Include formats supported by FFplay
      if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.webm'].includes(ext)) {
        const fullPath = path.join(musicDir, file);
        const fileStat = await stat(fullPath);
        
        if (fileStat.isFile()) {
          audioFiles.push({
            name: path.basename(file, ext), // Track name without extension
            filename: file,
            path: fullPath
          });
        }
      }
    }

    return audioFiles;
  } catch (error) {
    console.error('Error reading music directory:', error.message);
    return [];
  }
}
