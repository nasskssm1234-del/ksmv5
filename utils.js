export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'LIVE / inconnue';

  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function truncate(text, max = 90) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function isYouTubeUrl(input) {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return [
      'youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'youtube-nocookie.com',
    ].includes(hostname);
  } catch {
    return false;
  }
}

export function looksLikeUrl(input) {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
