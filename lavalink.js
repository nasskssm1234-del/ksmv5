import { Shoukaku, Connectors } from 'shoukaku';
import { EmbedBuilder } from 'discord.js';
import { formatDuration, truncate } from './utils.js';

const host = process.env.LAVALINK_HOST || 'lava-v4.millohost.my.id';
const port = Number(process.env.LAVALINK_PORT || 443);
const secure = (process.env.LAVALINK_SECURE || 'true').toLowerCase() === 'true';
const password = process.env.LAVALINK_PASSWORD;
const maxQueue = Math.max(10, Number(process.env.MAX_QUEUE) || 100);
const defaultVolume = Math.min(200, Math.max(1, Number(process.env.DEFAULT_VOLUME) || 70));
const idleMinutes = Math.max(0, Number(process.env.AUTO_LEAVE_MINUTES) || 0);

export class LavalinkMusicManager {
  constructor(client) {
    if (!password) throw new Error('LAVALINK_PASSWORD absent du fichier .env');
    this.nodes = new Shoukaku(new Connectors.DiscordJS(client), [{ name: 'DeadShot', url: `${host}:${port}`, auth: password, secure }], { moveOnDisconnect: false, resume: true, resumeTimeout: 60, reconnectTries: 10, reconnectInterval: 5, restTimeout: 30, voiceConnectionTimeout: 20 });
    this.players = new Map();
    this.nodes.on('ready', (name) => console.log(`✅ Lavalink connecté : ${name}`));
    this.nodes.on('error', (name, error) => console.error(`❌ Lavalink ${name}:`, error));
    this.nodes.on('close', (name, code) => console.warn(`⚠️ Lavalink ${name} déconnecté (${code})`));
    this.nodes.on('disconnect', name => console.warn(`⚠️ Lavalink ${name} : reconnexion en attente`));
  }
  get(guild) {
    if (!this.players.has(guild.id)) this.players.set(guild.id, new LavalinkGuildPlayer(this, guild));
    return this.players.get(guild.id);
  }
  remove(id) { const player = this.players.get(id); if (player) void player.disconnect(); this.players.delete(id); }
  destroyAll() { for (const id of this.players.keys()) this.remove(id); }
}

class LavalinkGuildPlayer {
  constructor(manager, guild) {
    this.manager = manager; this.guild = guild; this.queue = []; this.current = null;
    this.player = null; this.voiceChannelId = null; this.textChannel = null;
    this.volume = defaultVolume; this.loopMode = 'off'; this.idleTimer = null;
    this.generation = 0; this.transition = Promise.resolve(); this.connecting = null; this.playbackToken = 0;
  }
  async connect(channel) {
    clearTimeout(this.idleTimer);
    if (this.player) {
      if (this.voiceChannelId !== channel.id) throw new Error('Le bot est déjà utilisé dans un autre salon vocal.');
      return;
    }
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect(channel);
    try { await this.connecting; } finally { this.connecting = null; }
  }
  async doConnect(channel) {
    const node = this.manager.nodes.options.nodeResolver(this.manager.nodes.nodes);
    if (!node) throw new Error('Aucun serveur Lavalink connecté. Vérifie le host, port et mot de passe.');
    const player = await this.manager.nodes.joinVoiceChannel({ guildId: this.guild.id, channelId: channel.id, shardId: this.guild.shardId, deaf: true });
    this.player = player; this.voiceChannelId = channel.id;
    player.on('end', data => {
      if (this.player !== player || !['finished', 'loadFailed'].includes(data.reason)) return;
      const token = this.playbackToken;
      this.enqueueTransition(() => token === this.playbackToken ? this.next(data.reason === 'finished') : undefined);
    });
    player.on('exception', error => console.error(`[${this.guild.name}] Lavalink playback:`, error));
    player.on('stuck', () => { const token = this.playbackToken; this.enqueueTransition(() => token === this.playbackToken ? this.next(false) : undefined); });
    player.on('closed', () => { if (this.player === player) void this.disconnect(); });
    await player.setGlobalVolume(this.volume);
  }
  enqueueTransition(fn) {
    this.transition = this.transition.then(fn).catch(error => console.error('Lavalink transition:', error));
    return this.transition;
  }
  async resolve(input, user) {
    const node = this.player?.node;
    if (!node) throw new Error('Lavalink indisponible.');
    const identifier = /^https?:\/\//i.test(input) ? input : `ytsearch:${input}`;
    const result = await node.rest.resolve(identifier);
    if (result?.loadType === 'error') throw new Error(result.data?.message || 'Erreur de chargement Lavalink');
    const tracks = Array.isArray(result?.data) ? result.data : (result?.data?.tracks || []);
    const selected = result?.loadType === 'track' ? [result.data] : tracks;
    if (!selected?.length) throw new Error('Aucun morceau trouvé. La source doit être activée sur le serveur Lavalink.');
    return selected.slice(0, maxQueue).map(t => ({
      encoded: t.encoded, title: t.info.title, url: t.info.uri || input,
      uploader: t.info.author || 'Inconnu', duration: Math.floor((t.info.length || 0) / 1000),
      thumbnail: t.info.artworkUrl || null, requestedBy: { id: user.id, mention: `<@${user.id}>` },
    }));
  }
  async add(input, user, voice, textChannel) {
    await this.connect(voice);
    this.textChannel = textChannel;
    const tracks = await this.resolve(input, user);
    const available = maxQueue - this.queue.length;
    if (available < tracks.length) throw new Error(`File limitée à ${maxQueue} morceaux.`);
    this.queue.push(...tracks);
    const started = !this.current;
    if (started) await this.enqueueTransition(() => this.next(false));
    return { track: tracks[0], started, position: started ? 0 : this.queue.indexOf(tracks[0]) + 1, count: tracks.length };
  }
  async next(finished) {
    if (finished && this.current) {
      if (this.loopMode === 'song') this.queue.unshift(this.current);
      if (this.loopMode === 'queue') this.queue.push(this.current);
    }
    this.playbackToken++;
    this.current = this.queue.shift() || null;
    if (!this.current) {
      if (idleMinutes) this.idleTimer = setTimeout(() => { if (!this.current && !this.queue.length) this.disconnect(); }, idleMinutes * 60000);
      return;
    }
    try {
      await this.player.playTrack({ track: { encoded: this.current.encoded } });
      const t = this.current;
      const embed = new EmbedBuilder().setTitle('▶️ Lecture en cours').setDescription(`[${truncate(t.title, 180)}](${t.url})`).addFields({ name: 'Artiste', value: truncate(t.uploader, 90), inline: true }, { name: 'Durée', value: formatDuration(t.duration), inline: true });
      if (t.thumbnail) embed.setThumbnail(t.thumbnail);
      await this.textChannel?.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
      await this.textChannel?.send(`❌ Lavalink : ${truncate(error.message, 250)}`).catch(() => {});
      await this.next(false);
    }
  }
  pause() { if (!this.current || !this.player) return false; void this.player.setPaused(true).catch(console.error); return true; }
  resume() { if (!this.current || !this.player) return false; void this.player.setPaused(false).catch(console.error); return true; }
  skip() { if (!this.current) return false; void this.enqueueTransition(async () => { this.playbackToken++; await this.player.stopTrack(); await this.next(false); }); return true; }
  stop() { this.playbackToken++; this.queue = []; this.current = null; clearTimeout(this.idleTimer); void this.player?.stopTrack().catch(console.error); }
  async disconnect() {
    this.stop(); const player = this.player; this.player = null; this.voiceChannelId = null;
    if (player) await this.manager.nodes.leaveVoiceChannel(this.guild.id).catch(console.error);
  }
  destroy() { this.disconnect(); }
  setVolume(v) { this.volume = v; void this.player?.setGlobalVolume(v).catch(console.error); }
  setLoop(v) { this.loopMode = v; }
  shuffle() { for (let i = this.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; } }
}
