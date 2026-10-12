import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { EmbedBuilder } from 'discord.js';
import { resolveTrack, spawnAudioDownload } from './ytdlp.js';
import { formatDuration, truncate } from './utils.js';

const DEFAULT_VOLUME = Math.min(200, Math.max(1, Number(process.env.DEFAULT_VOLUME) || 70));
const AUTO_LEAVE_MINUTES = Math.max(0, Number(process.env.AUTO_LEAVE_MINUTES) || 0);
const MAX_QUEUE = Math.max(10, Number(process.env.MAX_QUEUE) || 100);
const AUDIO_START_TIMEOUT_MS = Math.max(10_000, Number(process.env.AUDIO_START_TIMEOUT_MS) || 30_000);
const STDERR_LIMIT = 24_000;

function sanitizeError(error) {
  const text = String(error?.message || error || 'Erreur inconnue');
  const firstLine = text.split(/\r?\n/).find(Boolean) || text;
  if (/Sign in to confirm|cookies|age.?restricted/i.test(text)) {
    return 'YouTube exige une authentification pour cette vidéo. Le bot est configuré sans cookie, donc elle ne peut pas être lue.';
  }
  if (/PO Token|HTTP Error 403|Forbidden/i.test(text)) {
    return 'YouTube a refusé ce flux (403 / protection de lecture). Essaie une autre vidéo publique ou mets yt-dlp à jour.';
  }
  return truncate(firstLine.replace(/^ERROR:\s*/i, ''), 300);
}

function appendLimited(current, chunk) {
  const next = current + chunk;
  return next.length > STDERR_LIMIT ? next.slice(-STDERR_LIMIT) : next;
}

function safeKill(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGKILL'); } catch {}
}

export class GuildMusicPlayer {
  constructor(guild) {
    this.guild = guild;
    this.queue = [];
    this.current = null;
    this.connection = null;
    this.voiceChannelId = null;
    this.textChannel = null;
    this.volume = DEFAULT_VOLUME;
    this.loopMode = 'off';
    this.skipOnce = false;
    this.idleTimer = null;
    this.pipeline = null;
    this.stopping = false;
    this.destroyed = false;
    this.transition = Promise.resolve();

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.runTransition(() => this.handleIdle());
    });

    this.player.on('error', error => {
      console.error(`[${this.guild.name}] AudioPlayer error:`, error);
      void this.textChannel?.send(`❌ Lecture impossible : ${sanitizeError(error)}`).catch(() => {});
      this.killPipeline();
      this.skipOnce = true;
      this.player.stop(true);
    });
  }

  runTransition(task) {
    this.transition = this.transition
      .then(async () => {
        if (!this.destroyed) await task();
      })
      .catch(error => console.error(`[${this.guild.name}] Transition error:`, error));
    return this.transition;
  }

  async connect(voiceChannel) {
    this.clearIdleTimer();

    if (this.connection && this.voiceChannelId === voiceChannel.id) {
      if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000)
          .catch(() => { throw new Error('La connexion vocale ne répond pas. Réessaie dans quelques secondes.'); });
      }
      return;
    }
    if (this.connection && this.voiceChannelId !== voiceChannel.id) {
      throw new Error('Le bot est déjà utilisé dans un autre salon vocal de ce serveur.');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection = connection;
    this.voiceChannelId = voiceChannel.id;
    connection.subscribe(this.player);

    connection.on('error', error => {
      console.error(`[${this.guild.name}] Voice connection error:`, error);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.connection !== connection || this.destroyed) return;
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        if (this.connection === connection) this.disconnect();
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      if (this.connection === connection) this.disconnect();
      throw new Error('Impossible de rejoindre le salon vocal. Vérifie les permissions Connecter/Parler.');
    }
  }

  async add(input, user, voiceChannel, textChannel) {
    this.textChannel = textChannel;
    if (this.queue.length >= MAX_QUEUE) throw new Error(`La file est pleine (${MAX_QUEUE} morceaux maximum).`);
    // Connexion vocale et recherche YouTube en parallèle : on économise la
    // latence de connexion au lieu d'attendre l'une puis l'autre.
    const [, track] = await Promise.all([
      this.connect(voiceChannel),
      resolveTrack(input, {
        id: user.id,
        username: user.username,
        mention: `<@${user.id}>`,
      }),
    ]);

    if (this.queue.length >= MAX_QUEUE) throw new Error(`La file est pleine (${MAX_QUEUE} morceaux maximum).`);
    this.queue.push(track);

    const shouldStart = !this.current && this.player.state.status === AudioPlayerStatus.Idle;
    if (shouldStart) await this.runTransition(() => this.playNext());

    return {
      track,
      started: shouldStart,
      position: shouldStart ? 0 : this.queue.indexOf(track) + 1,
    };
  }

  async playNext() {
    this.clearIdleTimer();
    this.killPipeline();

    if (!this.queue.length) {
      this.current = null;
      this.scheduleAutoLeave();
      return;
    }

    const track = this.queue.shift();
    this.current = track;
    this.stopping = false;

    try {
      const ytdlp = await spawnAudioDownload(track.url);
      const ffmpeg = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn', '-ac', '2', '-ar', '48000',
        '-f', 's16le', 'pipe:1',
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let gotAudio = false;
      let ytdlpError = '';
      let ffmpegError = '';
      const startTimer = setTimeout(() => {
        if (!gotAudio && this.current === track) {
          console.error(`[${this.guild.name}] Audio start timeout: ${track.title}`);
          void this.textChannel?.send('❌ YouTube ne fournit aucun flux audio. Je passe au morceau suivant.').catch(() => {});
          this.skipOnce = true;
          this.killPipeline();
          this.player.stop(true);
        }
      }, AUDIO_START_TIMEOUT_MS);
      startTimer.unref?.();

      this.pipeline = { ytdlp, ffmpeg, trackId: track.id || track.url, startTimer };

      ytdlp.stdout.once('data', () => {
        gotAudio = true;
        clearTimeout(startTimer);
      });
      ytdlp.stderr.setEncoding('utf8');
      ffmpeg.stderr.setEncoding('utf8');
      ytdlp.stderr.on('data', chunk => { ytdlpError = appendLimited(ytdlpError, chunk); });
      ffmpeg.stderr.on('data', chunk => { ffmpegError = appendLimited(ffmpegError, chunk); });

      ytdlp.on('error', error => {
        if (this.current !== track) return;
        console.error(`[${this.guild.name}] yt-dlp spawn error:`, error);
        this.skipOnce = true;
        this.player.stop(true);
      });
      ffmpeg.on('error', error => {
        if (this.current !== track) return;
        console.error(`[${this.guild.name}] FFmpeg spawn error:`, error);
        this.skipOnce = true;
        this.player.stop(true);
      });

      ytdlp.stdout.pipe(ffmpeg.stdin);
      ffmpeg.stdin.on('error', () => {}); // EPIPE attendu lors d'un skip/stop.

      ytdlp.once('close', code => {
        if (code !== 0 && !gotAudio && this.current === track) {
          clearTimeout(startTimer);
          void this.textChannel?.send(`❌ YouTube : ${sanitizeError(ytdlpError || `yt-dlp code ${code}`)}`).catch(() => {});
          this.skipOnce = true;
          this.player.stop(true);
        }
      });

      ffmpeg.once('close', code => {
        if (code !== 0 && this.current === track && ffmpegError.trim()) {
          console.error(`[${this.guild.name}] FFmpeg: ${ffmpegError.trim()}`);
        }
      });

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        metadata: track,
      });
      resource.volume?.setVolume(this.volume / 100);
      this.player.play(resource);
      await this.sendNowPlaying(track);
    } catch (error) {
      console.error(`[${this.guild.name}] playNext:`, error);
      await this.textChannel?.send(`❌ ${sanitizeError(error)}`).catch(() => {});
      this.current = null;
      this.killPipeline();
      await this.playNext();
    }
  }

  async handleIdle() {
    this.killPipeline();

    if (this.stopping) {
      this.stopping = false;
      this.current = null;
      this.scheduleAutoLeave();
      return;
    }

    const finished = this.current;
    const wasSkipped = this.skipOnce;
    this.skipOnce = false;

    if (finished && !wasSkipped) {
      if (this.loopMode === 'song') this.queue.unshift(finished);
      else if (this.loopMode === 'queue') this.queue.push(finished);
    }

    this.current = null;
    await this.playNext();
  }

  pause() { return this.player.pause(); }
  resume() { return this.player.unpause(); }

  skip() {
    if (!this.current) return false;
    this.skipOnce = true;
    this.killPipeline();
    return this.player.stop(true);
  }

  stop({ disconnect = false } = {}) {
    this.queue = [];
    this.skipOnce = true;
    this.stopping = true;
    this.killPipeline();
    this.player.stop(true);
    this.current = null;
    if (disconnect) this.disconnect();
  }

  disconnect() {
    this.clearIdleTimer();
    this.queue = [];
    this.current = null;
    this.skipOnce = false;
    this.stopping = true;
    this.killPipeline();
    this.player.stop(true);
    const connection = this.connection;
    this.connection = null;
    this.voiceChannelId = null;
    if (connection) {
      try { connection.destroy(); } catch {}
    }
  }

  destroy() {
    this.destroyed = true;
    this.disconnect();
  }

  setVolume(percent) {
    this.volume = percent;
    this.player.state.resource?.volume?.setVolume(percent / 100);
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  setLoop(mode) { this.loopMode = mode; }

  killPipeline() {
    if (!this.pipeline) return;
    const { ytdlp, ffmpeg, startTimer } = this.pipeline;
    this.pipeline = null;
    if (startTimer) clearTimeout(startTimer);
    try { ytdlp.stdout?.unpipe(ffmpeg.stdin); } catch {}
    try { ytdlp.stdout?.destroy(); } catch {}
    try { ffmpeg.stdin?.destroy(); } catch {}
    try { ffmpeg.stdout?.destroy(); } catch {}
    safeKill(ytdlp);
    safeKill(ffmpeg);
  }

  clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  scheduleAutoLeave() {
    if (!AUTO_LEAVE_MINUTES || !this.connection) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (!this.current && this.queue.length === 0) {
        void this.textChannel?.send(`👋 File vide depuis ${AUTO_LEAVE_MINUTES} min, je quitte le vocal.`).catch(() => {});
        this.disconnect();
      }
    }, AUTO_LEAVE_MINUTES * 60_000);
    this.idleTimer.unref?.();
  }

  async sendNowPlaying(track) {
    if (!this.textChannel?.send) return;
    const embed = new EmbedBuilder()
      .setTitle('▶️ Lecture en cours')
      .setDescription(`[${truncate(track.title, 200)}](${track.url})`)
      .addFields(
        { name: 'Chaîne', value: truncate(track.uploader, 100), inline: true },
        { name: 'Durée', value: formatDuration(track.duration), inline: true },
        { name: 'Demandé par', value: track.requestedBy.mention, inline: true },
      )
      .setFooter({ text: `YouTube uniquement • Volume ${this.volume}%` });
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    await this.textChannel.send({ embeds: [embed] }).catch(() => {});
  }
}

export class MusicManager {
  constructor() { this.players = new Map(); }

  get(guild) {
    if (!this.players.has(guild.id)) this.players.set(guild.id, new GuildMusicPlayer(guild));
    return this.players.get(guild.id);
  }

  remove(guildId) {
    const player = this.players.get(guildId);
    if (player) player.destroy();
    this.players.delete(guildId);
  }

  destroyAll() {
    for (const player of this.players.values()) player.destroy();
    this.players.clear();
  }
}
