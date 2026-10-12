import 'dotenv/config';
const host = process.env.LAVALINK_HOST;
const port = Number(process.env.LAVALINK_PORT || 443);
const secure = (process.env.LAVALINK_SECURE || 'true') === 'true';
const password = process.env.LAVALINK_PASSWORD;
if (!host || !password) { console.error('Host ou password manquant dans .env'); process.exitCode = 1; }
else {
 const url = `${secure ? 'https' : 'http'}://${host}:${port}/v4/info`;
 try {
  const response = await fetch(url, { headers: { Authorization: password }, signal: AbortSignal.timeout(12000) });
  console.log(`HTTP ${response.status} ${response.statusText}`);
  if (!response.ok) { console.error(response.status === 401 ? 'Mot de passe Lavalink refusé.' : 'Serveur indisponible ou API v4 non accessible.'); process.exitCode = 1; }
  else { const info = await response.json(); console.log('Version:', info.version?.semver || 'inconnue'); console.log('Sources:', (info.sourceManagers || []).join(', ') || 'aucune'); console.log('Plugins:', (info.plugins || []).map(p=>p.name).join(', ') || 'aucun'); }
 } catch(e) { console.error('Échec connexion:', e.message); process.exitCode = 1; }
}
