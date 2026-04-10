# Build & lancement — GitJournal Electron

## Prérequis

```bash
cd electron
pnpm install   # ou npm install
```

## Lancer en développement

```bash
pnpm dev
# équivalent : NODE_ENV=development electron .
```
Les DevTools sont ouverts automatiquement.

## Lancer sans DevTools

```bash
pnpm start
# équivalent : electron .
```

## Construire un distributable

| Commande | Cible |
|---|---|
| `pnpm build` | plateforme courante |
| `pnpm build:mac` | macOS (.dmg + .zip) |
| `pnpm build:win` | Windows (.exe NSIS + portable) |
| `pnpm build:linux` | Linux (.AppImage + .deb) |

Les artefacts sont générés dans `electron/dist/`.

> Les commandes `build` exécutent les tests automatiquement avant de packager.

## Numéro de version

Modifier `version.js` :

```js
export const VERSION = "1.x.x";
```

## Tests

```bash
pnpm test
# équivalent : node --test server/server.test.js
```
