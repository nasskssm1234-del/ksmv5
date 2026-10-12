import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandsJSON } from './commands.js';

const TOKEN = process.env.DISCORD_TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Configuration incomplète. Vérifie DISCORD_TOKEN et CLIENT_ID dans le fichier .env.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

try {
  console.log('🔄 Enregistrement des commandes slash globales...');

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commandsJSON },
  );

  console.log(`✅ ${commandsJSON.length} commandes enregistrées avec succès.`);
  console.log('🌍 Déploiement global terminé — aucun GUILD_ID nécessaire.');
  console.log('ℹ️ Discord peut mettre quelques minutes avant d’afficher les commandes partout.');
} catch (error) {
  console.error('❌ Échec du déploiement des commandes :');
  console.error(error);
  process.exit(1);
}
