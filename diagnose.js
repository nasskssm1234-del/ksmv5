import { generateDependencyReport } from '@discordjs/voice';
import ffmpegPath from 'ffmpeg-static';
import { getYtDlpVersion, ensureYtDlp } from './ytdlp.js';

console.log(`Node: ${process.version}`);
console.log(`FFmpeg: ${ffmpegPath}`);
console.log(generateDependencyReport());

try {
  await ensureYtDlp();
  console.log(`yt-dlp: ${await getYtDlpVersion()}`);
} catch (error) {
  console.error('yt-dlp ERROR:', error.message);
  process.exitCode = 1;
}
