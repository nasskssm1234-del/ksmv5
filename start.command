#!/bin/bash
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "[ERREUR] Copie .env.example en .env puis remplis DISCORD_TOKEN et CLIENT_ID."
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install || exit 1
fi
npm start
