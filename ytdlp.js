import { spawn } from 'node:child_process';
import { chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { isYouTubeUrl, looksLikeUrl } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BIN_DIR = join(ROOT, 'bin');
const SEARCH_CACHE_TTL_MS = Math.max(30_000, Number(process.env.SEARCH_CACHE_TTL_MS) || 10 * 60_000);
const SEARCH_CACHE_MAX = Math.max(20, Number(process.env.SEARCH_CACHE_MAX) || 200);
const searchCache = new Map();
let ytDlpReadyPath = null;

function getAsset() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    if (arch === 'arm64') return { asset: 'yt-dlp_arm64.exe', filename: 'yt-dlp.exe' };
    if (arch === 'x64') return { asset: 'yt-dlp.exe', filename: 'yt-dlp.exe' };
  }

  if (platform === 'darwin') {
    return { asset: 'yt-dlp_macos', filename: 'yt-dlp' };
  }

  if (platform === 'linux') {
    if (arch === 'x64') return { asset: 'yt-dlp_linux', filename: 'yt-dlp' };
    if (arch === 'arm64') return { asset: 'yt-dlp_linux_aarch64', filename: 'yt-dlp' };
  }

  throw new Error(`Plateforme non prise en charge automatiquement : ${platform}/${arch}`);
}

export function getYtDlpPath() {
  const { filename } = getAsset();
  return join(BIN_DIR, filename);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'youtube-only-discord-bot/1.0' },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement yt-dlp impossible (${response.status} ${response.statusText})`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

export async function ensureYtDlp({ force = false } = {}) {
  if (!force && ytDlpReadyPath) return ytDlpReadyPath;
  await mkdir(BIN_DIR, { recursive: true });

  const { asset } = getAsset();
  const binaryPath = getYtDlpPath();

  if (!force && await exists(binaryPath)) {
    if (os.platform() !== 'win32') await chmod(binaryPath, 0o755);
    ytDlpReadyPath = binaryPath;
    return binaryPath;
  }

  const tempPath = `${binaryPath}.download`;
  try {
    if (await exists(tempPath)) await unlink(tempPath);
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
    console.log(`[yt-dlp] Téléchargement de ${asset}…`);
    await download(url, tempPath);
    if (os.platform() !== 'win32') await chmod(tempPath, 0o755);
    if (await exists(binaryPath)) await unlink(binaryPath);
    await rename(tempPath, binaryPath);
    console.log('[yt-dlp] Installation terminée.');
    ytDlpReadyPath = binaryPath;
    return binaryPath;
  } catch (error) {
    if (await exists(tempPath)) await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function commonArgs() {
  // Depuis 2025/2026, yt-dlp a besoin d’un moteur JS pour le support YouTube complet.
  // Node est déjà installé pour faire tourner le bot, donc aucun Deno/cookie n’est requis ici.
  return ['--ignore-config', '--no-plugin-dirs', '--js-runtimes', 'node', '--no-warnings'];
}

function execCapture(binary, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL');
      settled = true;
      reject(new Error('YouTube met trop de temps à répondre.'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `yt-dlp a quitté avec le code ${code}`));
    });
  });
}

export async function getYtDlpVersion() {
  const binary = await ensureYtDlp();
  const { stdout } = await execCapture(binary, ['--version']);
  return stdout.trim();
}

function normalizeSearchKey(value) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function getCachedSearch(key) {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.savedAt > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  // LRU simple : le résultat récemment utilisé repasse en fin de Map.
  searchCache.delete(key);
  searchCache.set(key, cached);
  return cached.track;
}

function cacheSearch(key, track) {
  searchCache.delete(key);
  searchCache.set(key, { savedAt: Date.now(), track });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value);
  }
}

export async function resolveTrack(input, requestedBy) {
  const binary = await ensureYtDlp();
  const trimmed = input.trim();

  if (!trimmed) throw new Error('La recherche est vide.');
  if (looksLikeUrl(trimmed) && !isYouTubeUrl(trimmed)) {
    throw new Error('Ce bot accepte uniquement des liens YouTube.');
  }

  const directUrl = isYouTubeUrl(trimmed);
  const cacheKey = directUrl ? null : normalizeSearchKey(trimmed);
  if (cacheKey) {
    const cached = getCachedSearch(cacheKey);
    if (cached) return { ...cached, requestedBy };
  }

  const target = directUrl ? trimmed : `ytsearch1:${trimmed}`;
  const args = [
    ...commonArgs(),
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    '--quiet',
  ];

  // Pour une recherche texte, --flat-playlist évite l'extraction complète de la
  // page vidéo. On obtient le premier résultat beaucoup plus vite et le flux
  // audio sera résolu seulement au moment de la lecture.
  if (!directUrl) args.push('--flat-playlist', '--playlist-end', '1');
  args.push(target);

  const { stdout } = await execCapture(binary, args, { timeoutMs: directUrl ? 45_000 : 20_000 });
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('Réponse YouTube illisible. Mets yt-dlp à jour avec npm run update-ytdlp.');
  }

  const item = Array.isArray(data.entries) ? data.entries.find(Boolean) : data;
  if (!item) throw new Error('Aucun résultat YouTube trouvé.');

  const id = item.id || (typeof item.url === 'string' && /^[\w-]{6,}$/.test(item.url) ? item.url : null);
  const url = item.webpage_url || item.original_url || (id ? `https://www.youtube.com/watch?v=${id}` : null);
  if (!url || !isYouTubeUrl(url)) throw new Error('Résultat YouTube invalide.');

  const baseTrack = {
    id: id ?? null,
    title: item.title || 'Titre inconnu',
    url,
    duration: Number(item.duration) || 0,
    uploader: item.uploader || item.channel || 'YouTube',
    thumbnail: item.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
  };

  if (cacheKey) cacheSearch(cacheKey, baseTrack);
  return { ...baseTrack, requestedBy };
}

export async function spawnAudioDownload(url) {
  const binary = await ensureYtDlp();
  const args = [
    ...commonArgs(),
    '--no-playlist',
    '--quiet',
    '--no-progress',
    '-f',
    'bestaudio/best',
    '-o',
    '-',
    url,
  ];

  return spawn(binary, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
