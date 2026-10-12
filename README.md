# YouTube Only Discord Bot

Bot musique Discord local **YouTube uniquement**, sans cookie, sans compte Google, sans Lavalink et sans clé API YouTube.

## Ce qu'il fait

- `/play <titre ou lien YouTube>`
- `/pause`
- `/resume`
- `/skip`
- `/stop`
- `/leave`
- `/queue`
- `/nowplaying`
- `/volume 1-200`
- `/loop off|song|queue`
- `/shuffle`
- `/help`
- File d'attente séparée pour chaque serveur Discord
- Téléchargement automatique du binaire officiel `yt-dlp`
- FFmpeg fourni automatiquement par `ffmpeg-static`
- Aucune clé API YouTube
- Aucun cookie YouTube
- Aucun compte Google
- Aucun Lavalink

## Prérequis

Installe **Node.js 22.12 ou plus récent**.

> Le projet est volontairement épinglé sur des versions de discord.js compatibles avec cette base. Ne lance pas `npm update` au hasard si tout fonctionne.

## 1. Créer le bot sur Discord

1. Va sur le **Discord Developer Portal**.
2. `New Application` → donne un nom au bot.
3. Ouvre **Bot** → `Add Bot` si nécessaire.
4. Copie le **Token** du bot.
5. Dans **General Information**, copie l'**Application ID**.
6. Dans **OAuth2 > URL Generator** :
   - Scopes : `bot` + `applications.commands`
   - Permissions : `View Channels`, `Send Messages`, `Connect`, `Speak`
7. Ouvre le lien généré et ajoute le bot à ton serveur.

Aucun `Message Content Intent` n'est nécessaire.

## 2. Configurer le projet

Duplique `.env.example` et renomme la copie en `.env`.

Exemple :

```env
DISCORD_TOKEN=ton_token_ici
CLIENT_ID=ton_application_id_ici
DEFAULT_VOLUME=70
AUTO_LEAVE_MINUTES=5
```

Les commandes slash sont enregistrées **globalement** sur Discord. Elles peuvent parfois prendre quelques minutes avant d’apparaître sur tous les serveurs où le bot est installé.

## 3. Installer et démarrer

### Windows

Double-clique sur `start.bat`.

Ou dans PowerShell / Terminal :

```powershell
npm install
npm start
```

### macOS

Dans le Terminal :

```bash
npm install
npm start
```

Tu peux aussi lancer `start.command` après lui avoir donné l'autorisation d'exécution si macOS le demande.

### Linux

```bash
npm install
npm start
```

Au premier démarrage, le bot télécharge automatiquement le binaire officiel `yt-dlp` correspondant à ton système dans le dossier `bin/`.

## 4. Utilisation

Rejoins un salon vocal puis :

```text
/play recherche: Stromae Alors on danse
```

ou :

```text
/play recherche: https://www.youtube.com/watch?v=...
```

Si tu donnes un lien qui n'est pas un lien YouTube, le bot le refuse.

## Mise à jour de yt-dlp

YouTube change souvent son système de lecture. Si un jour les recherches ou lectures ne fonctionnent plus :

```bash
npm run update-ytdlp
```

Puis redémarre le bot.

## Diagnostic

```bash
npm run diagnose
```

Cette commande affiche les versions de Node, Discord Voice, FFmpeg, Opus et yt-dlp.

## Important : “sans cookie”

Ce bot ne lit **aucun cookie**, n'utilise **aucun compte Google** et ne demande **aucune clé API YouTube**. Il lance aussi `yt-dlp` avec `--ignore-config` et `--no-plugin-dirs`, afin qu'une configuration ou un plugin yt-dlp déjà présent sur ton ordinateur ne lui injecte pas de cookies ou d'authentification à ton insu.

En revanche, YouTube peut imposer certaines protections de lecture côté serveur. Une vidéo publique normale peut fonctionner alors qu'une vidéo avec restriction d'âge, vérification de compte ou certaines protections peut être refusée. Le bot affiche alors une erreur au lieu de demander tes cookies.

## Sécurité

Ne partage jamais ton fichier `.env` ni ton `DISCORD_TOKEN`. Si ton token est exposé, régénère-le immédiatement dans le Discord Developer Portal.

## Déployer les commandes slash

Après avoir rempli le fichier `.env`, exécute :

```bash
npm run deploy
```

Les commandes sont enregistrées globalement sur Discord. Aucun `GUILD_ID` n'est utilisé.
