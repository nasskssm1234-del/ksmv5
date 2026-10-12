import { SlashCommandBuilder } from 'discord.js';

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Recherche ou lit un lien avec Lavalink')
    .addStringOption(option =>
      option
        .setName('recherche')
        .setDescription('Titre, mots-clés ou lien compatible')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Met la musique en pause'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Reprend la lecture'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Passe au morceau suivant'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Arrête la musique et vide la file'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Fait quitter le salon vocal au bot'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Affiche la file d’attente'),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Affiche le morceau en cours'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Change le volume')
    .addIntegerOption(option =>
      option
        .setName('pourcent')
        .setDescription('Volume de 1 à 200')
        .setMinValue(1)
        .setMaxValue(200)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Configure la répétition')
    .addStringOption(option =>
      option
        .setName('mode')
        .setDescription('Mode de répétition')
        .setRequired(true)
        .addChoices(
          { name: 'Désactivé', value: 'off' },
          { name: 'Morceau', value: 'song' },
          { name: 'File', value: 'queue' },
        ),
    ),

  new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Mélange la file d’attente'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche les commandes du bot'),
];

export const commandsJSON = commandBuilders.map(command => command.toJSON());
