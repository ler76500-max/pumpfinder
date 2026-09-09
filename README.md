# PumpFinder V3

Version complète de l'assistant de décision Pump.fun.

## Ce qui est réellement connecté

V3 utilise le flux Bitquery V2 pour les trades Pump.fun en temps réel. Bitquery documente les streams de créations et de trades Pump.fun et fournit des prix USD, volumes, acheteurs/vendeurs et données de traders. Pump.fun ne publie pas de data API hébergée officiellement; Bitquery indexe l'activité on-chain avec un schéma documenté.

## Installation

1. Installer Node.js 20+.
2. Créer un compte Bitquery et générer un access token.
3. Copier `.env.example` en `.env`.
4. Mettre le token dans `BITQUERY_TOKEN`.
5. `npm install`
6. `npm start`
7. Ouvrir `http://localhost:3000`.

Bitquery V2 utilise `https://streaming.bitquery.io/graphql` en HTTP et `wss://streaming.bitquery.io/graphql` en WebSocket avec `Authorization: Bearer <token>`; le projet utilise aussi `?token=` sur le WebSocket, documenté par Bitquery.

## Telegram

Créer un bot avec BotFather, puis renseigner:
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

## Ce que le score fait

Il classe les tokens à partir de:
- volume 5/10/15 minutes;
- accélération du volume;
- pression acheteuse;
- nombre de traders distincts;
- momentum de prix;
- activité récente.

Il ne fabrique pas de holders, liquidité, créateur ou probabilité lorsque ces données ne sont pas disponibles.

## Pourquoi les probabilités ne sont pas affichées

Un score 90/100 n'est pas 90% de chance de gagner. Il faut d'abord enregistrer des milliers de signaux et leurs résultats à 5/15/30/60 minutes, puis calibrer un modèle hors échantillon. V3 affiche donc des scénarios mécaniques, clairement marqués comme non calibrés.

## Sécurité

- aucune seed phrase;
- aucune clé privée;
- aucun wallet;
- aucun ordre;
- aucune vente;
- aucun achat automatique.

L'utilisateur garde la décision et l'exécution.

## Limites

- Le flux de données et les limites dépendent du compte Bitquery.
- Les memecoins sont extrêmement spéculatifs.
- Le score n'est pas une garantie.
- Les scénarios ne sont pas des probabilités.
