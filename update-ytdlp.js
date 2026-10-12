import { ensureYtDlp, getYtDlpVersion } from './ytdlp.js';

try {
  await ensureYtDlp({ force: true });
  console.log(`✅ yt-dlp ${await getYtDlpVersion()} est prêt.`);
} catch (error) {
  console.error('❌ Mise à jour impossible :', error.message);
  process.exit(1);
}
