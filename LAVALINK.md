# DeadShot Lavalink — guide de vérification

1. Installer Node.js >= 22.12, exécuter `npm install`, copier `.env.example` vers `.env`.
2. Remplir `DISCORD_TOKEN`, `CLIENT_ID` et confirmer `LAVALINK_PASSWORD` auprès du fournisseur. Le mot de passe transmis ressemble à une invitation Discord : vérifier que c’est bien le mot de passe réel du nœud.
3. Lancer `npm run diagnose:lavalink` pour tester HTTPS, l’authentification et les sources/plugins.
4. Lancer `npm start`, puis tester `/play`, `/skip`, `/stop` et `/leave` dans un salon vocal.
5. Spotify, Deezer et Apple Music nécessitent des plugins et accès configurés par l’hébergeur ; Lavalink ne donne pas automatiquement accès à leurs flux audio natifs.
6. Le mode `MUSIC_ENGINE=legacy` conserve l’ancien moteur si le nœud distant tombe. Il faut redémarrer pour changer de moteur.

Aucune disponibilité à 100 % ne peut être garantie avec un nœud tiers.
