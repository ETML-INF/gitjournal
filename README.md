# GitJournal

Application Electron pour générer un journal de travail à partir des commits Git locaux.

## Première utilisation

### 1. Installer les dépendances

```bash
cd src
pnpm install
```

### 2. Lancer l'application

```bash
pnpm start
```

## Utilisation

### Créer un nouveau projet

1. Menu : **Fichier > Nouveau projet** (`Cmd+N` / `Ctrl+N`)
2. Choisir où sauvegarder le fichier `.gitj` — **le placer à la racine du dépôt git à analyser**
3. Remplir le formulaire :
   - **Nom du projet** : affiché dans le journal et l'export
   - **Nom d'utilisateur Git** : valeur qui apparaît dans `git log --author=…` (filtre vos commits)
   - **Date de début** : optionnel, ignore les commits antérieurs

> L'application utilise le dossier du fichier `.gitj` comme racine du dépôt git. L'URL GitHub (pour les liens de commits) est détectée automatiquement via `git remote get-url origin`.

### Format du fichier `.gitj`

```json
{
  "projectName": "Mon Projet",
  "me": "Prénom Nom",
  "journalStartDate": "2024-01-01T00:00:00.000Z",
  "exceptions": []
}
```

| Champ | Obligatoire | Description |
|---|---|---|
| `projectName` | oui | Nom affiché dans le journal |
| `me` | oui | Nom d'auteur git pour filtrer vos commits |
| `journalStartDate` | non | Date de début, format ISO 8601 |
| `exceptions` | oui | Entrées manuelles et modifications de commits |

> L'application scanne toutes les branches automatiquement (`git log --all`).

### Ouvrir un projet existant

Menu : **Fichier > Ouvrir projet** (`Cmd+O` / `Ctrl+O`)

### Format des messages de commit

L'application extrait les métadonnées entre crochets **n'importe où** dans le message :

```
feat: add login [30m done]
```

ou sur une ligne séparée :

```
feat: add login
[30m done]
Description détaillée...
```

**Format compact (crochet unique) :**

| Syntaxe | Résultat |
|---|---|
| `[2h30]` ou `[2h30m]` | 2h30 |
| `[45m]` | 45 minutes |
| `[1h]` | 1 heure |
| `[5]` | 5 minutes (unité implicite) |
| `[2h30 done]` | 2h30, statut Done |
| `[45m wip]` | 45 min, statut WIP |

**Format classique (multi-crochets) :**

| Syntaxe | Résultat |
|---|---|
| `[2][30]` | 2h30 |
| `[90]` | 90 minutes |
| `[Done]` / `[WIP]` | statut |

### Ajouter une entrée manuelle

1. Cliquer sur le bouton **+** en bas du tableau
2. Remplir le formulaire (nom, description, date, durée en minutes, statut)
3. Cliquer sur **Enregistrer**

### Modifier ou exclure une entrée

Cliquer sur une ligne du tableau pour ouvrir le formulaire de modification.

- **Enregistrer** : sauvegarde les modifications
- **Exclure** : retire un commit du journal (sans le supprimer de Git)
- **Supprimer** : supprime une entrée manuelle

### Exporter

| Action | Raccourci |
|---|---|
| Exporter en PDF | `Cmd+E` / `Ctrl+E` |
| Exporter en CSV | `Cmd+Shift+E` / `Ctrl+Shift+E` |
| Imprimer | `Cmd+P` / `Ctrl+P` |

Le CSV contient une colonne supplémentaire "Tâche (abrégé)" : texte extrait du nom du commit avant la première parenthèse ouvrante.

### Sauvegarder

Menu : **Fichier > Enregistrer** (`Cmd+S` / `Ctrl+S`)

Les modifications sont aussi sauvegardées automatiquement après chaque ajout ou modification.

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Cmd/Ctrl + N` | Nouveau projet |
| `Cmd/Ctrl + O` | Ouvrir projet |
| `Cmd/Ctrl + S` | Enregistrer |
| `Cmd/Ctrl + E` | Exporter en PDF |
| `Cmd/Ctrl + Shift + E` | Exporter en CSV |
| `Cmd/Ctrl + P` | Imprimer |
| `Cmd/Ctrl + R` | Actualiser |
| `Cmd/Ctrl + +/-` | Zoom |

## Versionner vos projets

Les fichiers `.gitj` peuvent être versionnés avec Git :

```bash
git add mon-projet.gitj
git commit -m "Mise à jour du journal"
git push
```

## Développement et build

Voir [src/BUILD.md](src/BUILD.md) pour les instructions détaillées.

```bash
cd src
pnpm dev          # mode développement (DevTools ouvert)
pnpm test         # lancer les tests
pnpm build        # build pour la plateforme courante
pnpm build:mac    # .dmg macOS
pnpm build:win    # .exe Windows
pnpm build:linux  # .AppImage / .deb Linux
```

Les artefacts sont générés dans `src/dist/`.

## Structure du projet

```
src/
├── main.js                 # Main process Electron
├── preload.js              # Bridge IPC sécurisé
├── version.js              # Numéro de version
├── package.json
├── assets/                 # Icônes de l'application
└── server/
    ├── server.js           # Serveur Express interne
    ├── lib/
    │   ├── commit-parser.js    # Parsing des métadonnées de commits
    │   ├── gitj-manager.js     # Lecture/écriture des fichiers .gitj
    │   └── settings-manager.js # Persistance des préférences
    └── views/              # Templates EJS
```

## Dépannage

### L'app ne démarre pas

- Vérifier que les dépendances sont installées (`pnpm install` dans `src/`)
- Consulter les logs dans la console de développement (`pnpm dev`)

### Le journal est vide

- Vérifier que le fichier `.gitj` est bien placé **à la racine du dépôt git**
- Vérifier que le champ `me` correspond exactement au nom d'auteur dans vos commits (`git log --author=…`)
- Vérifier que vos commits contiennent une durée entre crochets

### Pas de liens GitHub dans le tableau

- Vérifier que le dépôt a un remote `origin` pointant vers GitHub (`git remote -v`)

## Support

Pour rapporter un bug ou demander une fonctionnalité, créer une issue sur GitHub.
