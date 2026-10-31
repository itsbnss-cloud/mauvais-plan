# Mauvais Plan

Jeu coopératif en 2D vue du dessus pour **exactement deux joueurs**, chacun sur son ordinateur. Deux petits cambrioleurs cagoulés (violet et orange) doivent vider une maison et charger le butin dans leur camion en moins de cinq minutes, sans se faire attraper par le gardien ni repérer par la caméra.

- Client : TypeScript, Phaser 3, Vite. Tous les graphismes sont dessinés par le code, sans image externe.
- Serveur : Node.js, Express, Socket.IO. Le serveur est **autoritaire** : il calcule les positions, les collisions, le gardien, la caméra, le chrono et le score.
- Un seul processus Node sert le client compilé **et** les WebSockets sur le même domaine.

---

## 1. Installation et lancement

Prérequis : **Node.js 20 ou plus récent** (développé et testé avec Node 24) et npm.

```bash
cd mauvais-plan
npm install
```

### Mode développement (rechargement à chaud)

```bash
npm run dev
```

Cette commande lance deux processus :

- le serveur de jeu sur `http://localhost:3000` ;
- le client Vite sur **`http://localhost:5173`** : c'est cette adresse qu'il faut ouvrir. Vite relaie `/socket.io` vers le serveur.

### Mode production (comme en ligne)

```bash
npm run build
npm start
```

Ouvre ensuite **`http://localhost:3000`**. Le serveur sert le client compilé (`dist/client`) et accepte les WebSockets sur le même port.

### Tests

```bash
npm test           # règles du jeu + parcours multijoueur réel via Socket.IO
npm run typecheck  # vérification TypeScript
```

---

## 2. Tester à deux fenêtres en local

1. Lance `npm run dev` (ou `npm run build && npm start`).
2. Ouvre deux fenêtres : une fenêtre normale et une fenêtre de navigation privée, ou simplement deux onglets. Chaque onglet a sa propre session.
3. Fenêtre 1 : saisis un pseudo, clique sur **Créer une partie**, puis sur **Copier le lien**.
4. Fenêtre 2 : colle le lien. Le code est déjà rempli : saisis un pseudo et clique sur **Rejoindre**.
5. Clique sur **Je suis prêt !** dans les deux fenêtres. La partie démarre après un décompte de trois secondes.
6. Pour jouer, clique dans la fenêtre voulue : seule la fenêtre active reçoit le clavier.

À essayer aussi :

- **Rafraîchis** une fenêtre en pleine partie : la partie se met en pause, puis reprend avec le même personnage.
- **Ferme** une fenêtre : l'autre joueur voit un compte à rebours de 60 secondes, puis un message et un bouton « Retour au salon ».
- Ouvre une **troisième** fenêtre avec le même code : elle est refusée (« partie déjà complète »).

> Avec quelqu'un sur le **même réseau Wi-Fi**, l'autre personne peut utiliser l'adresse IP locale de ton ordinateur (Vite affiche une ligne `Network: http://192.168…:5173`). Cela ne marche **pas** pour quelqu'un situé ailleurs : `localhost` et les adresses locales ne sont pas accessibles depuis Internet. Pour ça, il faut héberger le jeu (section suivante).

---

## 3. Mise en ligne (accès depuis Internet)

> **État actuel : le jeu n'est pas encore en ligne.** Il tourne uniquement sur ton ordinateur. Le projet est prêt à être déployé, mais l'étape d'hébergement reste à faire avec ton propre compte chez un hébergeur.

Il faut un hébergeur qui accepte **un serveur Node.js qui tourne en continu** et **les WebSockets**. Les hébergeurs « serverless » ou de sites statiques (Netlify, Vercel en mode fonctions, GitHub Pages…) **ne conviennent pas**.

Important : les parties sont gardées **en mémoire**. Il faut **une seule instance** du serveur (pas de mise à l'échelle horizontale), et un redémarrage efface les parties en cours.

### Option A : Render (le plus simple)

1. Pousse le dossier `mauvais-plan/` sur un dépôt GitHub. Il peut être à la racine du dépôt ou dans un sous-dossier.
2. Sur [render.com](https://render.com) : **New → Web Service**, puis choisis le dépôt.
3. Réglages :
   - **Root Directory** : `mauvais-plan` (si le projet est dans un sous-dossier) ;
   - **Runtime** : Node ;
   - **Build Command** : `npm ci && npm run build` ;
   - **Start Command** : `npm start` ;
   - **Instance count** : 1.
4. Pas de variable obligatoire : Render fournit `PORT`. Tu peux ajouter `NODE_VERSION=22` si besoin.
5. Une fois le déploiement terminé, Render donne une adresse du type `https://mauvais-plan-xxxx.onrender.com`. Ouvre-la, crée une partie et envoie le lien d'invitation : il pointe automatiquement vers ce domaine. Les WebSockets passent en `wss://`, sans réglage supplémentaire.

Attention : sur l'offre gratuite, le service se met en veille après une période d'inactivité. La première visite qui suit prend alors plusieurs dizaines de secondes.

### Option B : n'importe quel hébergeur Docker (Railway, Fly.io, un VPS…)

Un `Dockerfile` est fourni :

```bash
docker build -t mauvais-plan .
docker run -p 3000:3000 mauvais-plan
```

- **Railway** : New Project → Deploy from GitHub repo. Le `Dockerfile` est détecté automatiquement ; il faut ensuite générer un domaine public dans Settings → Networking.
- **Fly.io** : `fly launch` (le `Dockerfile` est détecté ; port interne 3000), puis `fly scale count 1` pour garder une seule machine.
- **VPS** : `npm ci && npm run build && npm start` derrière un reverse proxy (Nginx, Caddy) qui transmet les en-têtes `Upgrade`/`Connection` pour les WebSockets, avec HTTPS.

Après le déploiement, vérifie que `https://ton-domaine/health` répond `{"ok":true,…}`.

### Variables d'environnement

| Variable     | Obligatoire | Défaut                    | Rôle                                                                                |
| ------------ | ----------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `PORT`       | non         | `3000`                    | Port HTTP/WebSocket. Fourni automatiquement par la plupart des hébergeurs.          |
| `HOST`       | non         | `0.0.0.0`                 | Interface d'écoute.                                                                 |
| `STATIC_DIR` | non         | `dist/client`             | Dossier du client compilé, si tu changes l'organisation des fichiers.              |
| `NODE_ENV`   | non         | `production` pour le serveur compilé | En développement (`npm run dev`), le serveur ne sert pas le client : c'est Vite qui le fait. |

---

## 4. Comment jouer

| Touche                                    | Action                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| ZQSD (AZERTY), WASD (QWERTY) ou flèches   | Se déplacer                                                                         |
| E                                         | Interagir : prendre un objet, saisir une poignée, confirmer le départ               |
| E maintenu                                | Couper la caméra (boîtier électrique dehors), libérer son complice (cadenas du cabanon, 2 s) |
| Espace                                    | Lâcher l'objet porté                                                                |

- **Petits objets** (grille-pain, console, collier, ordinateur portable) : un seul à la fois, et on marche un peu moins vite en le portant. Ils sont comptés dès qu'ils entrent dans la zone de fuite jaune.
- **Gros objets** (horloge, coffre-fort) : chaque joueur prend une poignée avec E. L'objet n'avance que si les deux poussent dans la même direction : il reste immobile si un seul pousse ou si les directions s'opposent. Espace pose l'objet.
- **Gardien** : il suit une ronde. Son cône de vision est visible et ne traverse pas les murs. Un « ? » signale qu'il a un doute, un « ! » qu'il poursuit quelqu'un. S'il attrape un joueur, celui-ci lâche son objet et part au cabanon. Si les deux joueurs sont enfermés, la partie est perdue.
- **Caméra** : elle surveille l'entrée du salon. Si elle repère quelqu'un, le gardien vient voir. Maintenir E sur le boîtier électrique, sur la façade côté jardin, la coupe.
- **Fin** : les deux joueurs au camion appuient sur E pour partir tout de suite. À la fin du chrono, l'évasion ne réussit que si les deux sont dans la zone de fuite.

---

## 5. Architecture

```
mauvais-plan/
├── shared/            Code commun client/serveur
│   ├── constants.ts   Réglages (vitesses, portées, durées)
│   ├── geometry.ts    Collisions cercle/rectangle, lancer de rayons, ligne de vue
│   ├── map.ts         Carte : murs, portes, meubles, objets, ronde, caméra, cabanon
│   ├── rules.ts       Interactions disponibles, pas de déplacement d'un joueur
│   └── types.ts       Messages réseau
├── server/
│   ├── index.ts       Point d'entrée (sert aussi le client en production)
│   ├── app.ts         Express + Socket.IO + boucle de simulation à 60 Hz
│   ├── rooms.ts       Salons, codes, sessions, reconnexion, nettoyage
│   ├── game.ts        Simulation autoritaire d'une partie
│   ├── guard.ts       IA du gardien (ronde, méfiance, poursuite, enquête, fouille)
│   ├── nav.ts         Grille de navigation et A*
│   └── *.test.ts      Tests Vitest
└── client/
    ├── index.html     Écrans d'accueil, de salon et de jeu (DOM)
    └── src/
        ├── main.ts    Réseau, écrans, HUD, pause, fin de partie
        ├── game/      Scène Phaser, textures générées, décor, clavier
        └── sfx.ts     Petits sons synthétisés (Web Audio)
```

**Réseau.**

- Le client envoie 30 commandes par seconde (direction, E, Espace), chacune numérotée.
- Le serveur les applique dans l'ordre, avec un débit plafonné, puis renvoie l'état 20 fois par seconde.
- Le client affiche les autres entités avec 110 ms de retard, en interpolant entre deux états reçus.
- Pour son propre personnage, il prédit le déplacement avec le même code que le serveur (`shared/rules.ts`), puis rejoue les commandes pas encore confirmées pour corriger l'écart en douceur.
- Sans commande récente (fenêtre masquée, focus perdu, coupure), le serveur arrête le personnage.

**Sessions.**

- Le serveur remet un jeton secret à chaque joueur. Le client le garde en `sessionStorage`, propre à chaque onglet et conservé lors d'un rafraîchissement.
- Avec ce jeton, le joueur retrouve son siège et son personnage pendant 60 secondes après une déconnexion. Pendant ce délai, la partie est en pause.

**Garde-fous côté serveur.**

- Distances d'interaction vérifiées.
- Un objet ne peut être ni ramassé deux fois ni compté deux fois : l'état « livré » est définitif.
- Commandes nettoyées et débit limité.
- Pseudos nettoyés.
- Création et entrée dans les salons limitées en fréquence.
- Salons isolés par code.
- Salons supprimés quand ils sont vides ou abandonnés.

---

## 6. Ce qui a été vérifié

**Tests automatisés (`npm test`, 32 tests).**

- Règles du jeu : les murs bloquent les joueurs, les gros objets et la vision ; ramassage unique et dépôt compté une seule fois ; distance d'interaction ; transport à deux (immobile si un seul pousse ou si les directions s'opposent, porteurs attachés) ; trajet complet de l'horloge et du coffre jusqu'au camion.
- Gardien et caméra : capture avec perte de l'objet ; cabanon fermé ; libération en 2 s ; défaite si les deux sont enfermés ; poursuite puis abandon ; détection par la caméra et coupure par l'interrupteur.
- Fin de partie : fin anticipée et fin au chrono ; pause.
- Multijoueur réel via Socket.IO : création, entrée, code invalide, salon complet, pause et reprise avec le jeton, refus d'un faux jeton, délai de 60 s, retour au salon, rejouer qui remet tout à zéro, isolation des salons.

**Deux navigateurs (Chromium headless pilotés au clavier, contre le serveur de production et contre le mode dev).**

- Création et entrée dans un salon par le lien d'invitation, refus du code invalide et du 3ᵉ joueur.
- Positions identiques dans les deux fenêtres.
- Mur infranchissable ; arrêt immédiat après relâchement des touches et après perte de focus.
- Rafraîchissement d'une fenêtre en pleine partie : même siège, même position.
- Vol et dépôt du grille-pain (150 €, vu par les deux) ; capture par le gardien après repérage par la caméra.
- Transport de l'horloge à deux : immobile si un seul pousse, bloquée si les directions s'opposent, avance ensemble.
- Départ anticipé, puis « Rejouer » qui remet à zéro.
- Fermeture d'une fenêtre : pause, puis message d'abandon et retour au salon au bout de 60 s.

**Non vérifié.**

- Le jeu entre deux machines réellement distantes (latence Internet, autre pays) : il n'est pas encore déployé.
- Firefox et Safari : les tests ont été faits uniquement avec un navigateur basé sur Chromium.

---

## 7. Limites connues de cette première version

- **Parties en mémoire** : un redémarrage du serveur les efface, et une seule instance est possible.
- **La reconnexion dépend de l'onglet** : un rafraîchissement retrouve la partie. Fermer l'onglet puis rouvrir le lien ne la retrouve pas, car c'est une nouvelle session. Le siège se libère au bout de 60 s.
- **Transport des gros objets** : il est calculé par le serveur, sans prédiction locale. Avec beaucoup de latence, il réagit avec un léger retard.
- **Pas de contrôles tactiles** : le jeu se joue au clavier sur ordinateur.
- **Gardien unique et IA simple** : il repère un blocage et recalcule son chemin, mais peut parfois hésiter si un gros objet est posé dans une porte.
- **Pas de comptes, de classement ni de chat vocal** : utilisez un appel à côté pour vous coordonner.
- Pour le débogage et les tests automatisés, l'état reçu par le client est lisible en lecture seule via `window.__mp` dans la console.
