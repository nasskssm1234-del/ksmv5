import 'dotenv/config';
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
} from 'discord.js';
import { commandsJSON } from './commands.js';
import { MusicManager } from './music.js';
import { LavalinkMusicManager } from './lavalink.js';
import { ensureYtDlp, getYtDlpVersion } from './ytdlp.js';
import { formatDuration, truncate } from './utils.js';

const TOKEN = process.env.DISCORD_TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Configuration incomplète. Copie .env.example vers .env et remplis DISCORD_TOKEN + CLIENT_ID.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const useLavalink = (process.env.MUSIC_ENGINE || 'lavalink').toLowerCase() === 'lavalink';
const music = useLavalink ? new LavalinkMusicManager(client) : new MusicManager();

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandsJSON });
  console.log(`✅ ${commandsJSON.length} commandes globales enregistrées.`);
}

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

function sameVoiceOrThrow(interaction, player) {
  const channel = getVoiceChannel(interaction);
  if (!channel) throw new Error('Tu dois être dans un salon vocal.');
  if (player.voiceChannelId && player.voiceChannelId !== channel.id) {
    throw new Error('Tu dois être dans le même salon vocal que le bot.');
  }
  return channel;
}

function loopLabel(mode) {
  return { off: 'désactivée', song: 'morceau', queue: 'file' }[mode] ?? mode;
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

client.on('error', error => console.error('Discord client error:', error));
client.on('warn', warning => console.warn('Discord warning:', warning));
client.on('guildDelete', guild => music.remove(guild.id));

client.once('ready', async () => {
  console.log(`🤖 Connecté : ${client.user.tag}`);
  console.log(`🏠 ${client.guilds.cache.size} serveur(s)`);

  if (!useLavalink) try {
    const version = await getYtDlpVersion();
    console.log(`🎬 yt-dlp ${version}`);
  } catch (error) {
    console.error('⚠️ yt-dlp indisponible :', error.message);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const player = music.get(interaction.guild);

  try {
    switch (interaction.commandName) {
      case 'play': {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) throw new Error('Tu dois être dans un salon vocal pour lancer une musique.');
        if (player.voiceChannelId && player.voiceChannelId !== voiceChannel.id) {
          throw new Error('Le bot est déjà utilisé dans un autre salon vocal.');
        }

        await interaction.deferReply();
        const query = interaction.options.getString('recherche', true);
        const result = await player.add(query, interaction.user, voiceChannel, interaction.channel);

        if (result.started) {
          await interaction.editReply(`✅ Lancé : **${truncate(result.track.title, 100)}**`);
        } else {
          await interaction.editReply(`➕ Ajouté en file (#${result.position}) : **${truncate(result.track.title, 100)}**`);
        }
        break;
      }

      case 'pause': {
        sameVoiceOrThrow(interaction, player);
        if (!player.current) throw new Error('Aucune musique en cours.');
        const ok = player.pause();
        await safeReply(interaction, ok ? '⏸️ Pause.' : 'ℹ️ La lecture est déjà en pause.');
        break;
      }

      case 'resume': {
        sameVoiceOrThrow(interaction, player);
        if (!player.current) throw new Error('Aucune musique en cours.');
        const ok = player.resume();
        await safeReply(interaction, ok ? '▶️ Lecture reprise.' : 'ℹ️ La lecture n’est pas en pause.');
        break;
      }

      case 'skip': {
        sameVoiceOrThrow(interaction, player);
        if (!player.skip()) throw new Error('Aucune musique à passer.');
        await safeReply(interaction, '⏭️ Morceau passé.');
        break;
      }

      case 'stop': {
        sameVoiceOrThrow(interaction, player);
        player.stop();
        await safeReply(interaction, '⏹️ Musique arrêtée et file vidée.');
        break;
      }

      case 'leave': {
        sameVoiceOrThrow(interaction, player);
        player.disconnect();
        await safeReply(interaction, '👋 Déconnecté du vocal.');
        break;
      }

      case 'volume': {
        sameVoiceOrThrow(interaction, player);
        const percent = interaction.options.getInteger('pourcent', true);
        player.setVolume(percent);
        await safeReply(interaction, `🔊 Volume : **${percent}%**`);
        break;
      }

      case 'loop': {
        sameVoiceOrThrow(interaction, player);
        const mode = interaction.options.getString('mode', true);
        player.setLoop(mode);
        await safeReply(interaction, `🔁 Répétition : **${loopLabel(mode)}**`);
        break;
      }

      case 'shuffle': {
        sameVoiceOrThrow(interaction, player);
        if (player.queue.length < 2) throw new Error('Il faut au moins 2 morceaux en attente pour mélanger la file.');
        player.shuffle();
        await safeReply(interaction, '🔀 File mélangée.');
        break;
      }

      case 'nowplaying': {
        const track = player.current;
        if (!track) throw new Error('Aucune musique en cours.');
        const embed = new EmbedBuilder()
          .setTitle('🎵 En cours')
          .setDescription(`[${truncate(track.title, 200)}](${track.url})`)
          .addFields(
            { name: 'Chaîne', value: truncate(track.uploader, 100), inline: true },
            { name: 'Durée', value: formatDuration(track.duration), inline: true },
            { name: 'Volume', value: `${player.volume}%`, inline: true },
            { name: 'Loop', value: loopLabel(player.loopMode), inline: true },
          );
        if (track.thumbnail) embed.setThumbnail(track.thumbnail);
        await safeReply(interaction, { embeds: [embed] });
        break;
      }

      case 'queue': {
        if (!player.current && player.queue.length === 0) {
          await safeReply(interaction, '📭 La file est vide.');
          break;
        }

        const lines = [];
        if (player.current) {
          lines.push(`**▶ En cours** — [${truncate(player.current.title, 70)}](${player.current.url})`);
        }

        if (player.queue.length) {
          lines.push('', '**À suivre**');
          for (const [index, track] of player.queue.slice(0, 10).entries()) {
            lines.push(`${index + 1}. [${truncate(track.title, 65)}](${track.url}) • ${formatDuration(track.duration)}`);
          }
          if (player.queue.length > 10) lines.push(`… et ${player.queue.length - 10} autre(s).`);
        }

        await safeReply(interaction, lines.join('\n'));
        break;
      }

      case 'help': {
        const embed = new EmbedBuilder()
          .setTitle('🎵 DeadShot Music+')
          .setDescription(useLavalink ? 'Lecture via Lavalink : les sources disponibles dépendent des plugins installés sur le nœud.' : 'Lecture YouTube via yt-dlp.')
          .addFields(
            { name: '/play recherche', value: 'Lien pris en charge par Lavalink ou recherche par titre.' },
            { name: '/pause • /resume • /skip', value: 'Contrôle de lecture.' },
            { name: '/stop • /leave', value: 'Arrête la file ou quitte le vocal.' },
            { name: '/queue • /nowplaying', value: 'Affiche la file ou le morceau actuel.' },
            { name: '/volume', value: 'Volume de 1 à 200 %.' },
            { name: '/loop', value: 'Désactivé, morceau ou file.' },
            { name: '/shuffle', value: 'Mélange les morceaux en attente.' },
          )
          .setFooter({ text: 'Certaines vidéos protégées par YouTube peuvent refuser la lecture sans authentification.' });
        await safeReply(interaction, { embeds: [embed], ephemeral: true });
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error(`/${interaction.commandName}:`, error);
    const message = `❌ ${truncate(error.message || 'Erreur inconnue', 350)}`;
    await safeReply(interaction, { content: message, ephemeral: true }).catch(() => {});
  }
});

async function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt…`);
  music.destroyAll();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

try {
  if (!useLavalink) await ensureYtDlp();
  await registerCommands();
  await client.login(TOKEN);
} catch (error) {
  console.error('❌ Démarrage impossible :', error);
  process.exit(1);
}
