# GitJournal - Application Electron

Application Electron pour générer un journal de travail à partir des commits Git.

## Première utilisation

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configurer le GitHub Token

Le GitHub Token peut être configuré de deux façons :

**Option A : Via l'interface de l'application (Recommandé)**

1. Lancer l'application : `npm start`
2. Aller dans le menu : **GitJournal > Préférences...** (macOS) ou **Fichier > Préférences** (Windows/Linux)
3. Entrer votre GitHub Personal Access Token
4. Cliquer sur **Enregistrer**

Le lien dans la fenêtre de préférences vous permet de créer un nouveau token directement sur GitHub.

**Option B : Créer manuellement le fichier settings.json**

Créez le fichier selon votre OS :

- macOS : `~/Library/Application Support/GitJournal/settings.json`
- Windows : `%APPDATA%\GitJournal\settings.json`
- Linux : `~/.config/GitJournal/settings.json`

Contenu :
```json
{
  "githubToken": "ghp_votre_token_ici",
  "lastOpenedFile": null
}
```

**Comment créer un Personal Access Token GitHub :**
1. Aller sur https://github.com/settings/tokens
2. Cliquer sur "Generate new token (classic)"
3. Cocher : `repo` (accès complet aux repositories)
4. Générer le token et le copier

### 3. Lancer l'application

```bash
npm start
```

## Utilisation

### Créer un nouveau projet

1. Lancer l'application
2. Menu : **Fichier > Nouveau projet** (Cmd+N / Ctrl+N)
3. Choisir l'emplacement et le nom du fichier `.gitj`
4. Le fichier sera créé et ouvert automatiquement

### Configurer le projet

Le fichier `.gitj` contient la configuration du projet au format JSON :

```json
{
  "repoUrl": "https://github.com/utilisateur/repository",
  "projectName": "Mon Projet",
  "branch": "main",
  "me": "mon_username_github",
  "journalStartDate": "2024-01-01T00:00:00.000Z",
  "exceptions": []
}
```

Vous pouvez éditer ce fichier directement avec un éditeur de texte pour configurer :
- `repoUrl` : URL du repository GitHub
- `projectName` : Nom du projet (affiché dans le journal)
- `branch` : Branche à analyser (par défaut : `main`)
- `me` : Votre nom d'utilisateur GitHub (pour filtrer vos commits)
- `journalStartDate` : Date de début (optionnel, format ISO 8601)
- `exceptions` : Tableau des entrées modifiées ou sans commit

### Ouvrir un projet existant

1. Menu : **Fichier > Ouvrir projet** (Cmd+O / Ctrl+O)
2. Sélectionner un fichier `.gitj`

### Format des messages de commit

L'application parse vos messages de commit selon ce format :

```
Titre du commit
[2][30][Done]
Description détaillée...
```

- Ligne 1 : Titre
- Ligne 2 : Métadonnées entre crochets
  - Durée : `[2][30]` = 2h30 ou `[90]` = 90 minutes
  - Statut : `[Done]`, `[WIP]`, etc.
- Lignes suivantes : Description

### Ajouter des entrées manuelles

1. Cliquer sur le bouton **+** en haut à droite
2. Remplir le formulaire :
   - Nom
   - Description (optionnel)
   - Date et heure
   - Durée (en minutes)
   - Statut (Done, WIP)
3. Enregistrer

### Modifier une entrée

1. Clic droit sur une ligne du tableau
2. Modifier les informations dans le formulaire
3. Enregistrer

### Exporter en PDF

Menu : **Fichier > Exporter en PDF** (Cmd+E / Ctrl+E)

Le PDF sera généré avec mise en page optimisée pour l'impression.

### Sauvegarder

Menu : **Fichier > Enregistrer** (Cmd+S / Ctrl+S)

Note : Les modifications sont sauvegardées automatiquement à chaque ajout/modification d'entrée.

## Versionner vos projets avec Git

Les fichiers `.gitj` peuvent être versionnés avec Git :

```bash
git add mon-projet.gitj
git commit -m "Mise à jour du journal"
git push
```

**Important** : Le fichier `.gitj` ne contient PAS le GitHub Token (qui reste dans les settings de l'app).

## Mode développement

Lancer en mode développement (avec DevTools ouvert) :

```bash
npm run dev
```

## Build de l'application

### macOS

```bash
npm run build:mac
```

Génère un `.dmg` dans `dist/`

### Windows

```bash
npm run build:win
```

Génère un installeur `.exe` dans `dist/`

### Linux

```bash
npm run build:linux
```

Génère un `.AppImage` et `.deb` dans `dist/`

## Raccourcis clavier

- **Cmd/Ctrl + N** : Nouveau projet
- **Cmd/Ctrl + O** : Ouvrir projet
- **Cmd/Ctrl + S** : Enregistrer
- **Cmd/Ctrl + E** : Exporter en PDF
- **Cmd/Ctrl + P** : Imprimer
- **Cmd/Ctrl + R** : Actualiser
- **Cmd/Ctrl + +/-** : Zoom

## Dépannage

### L'app ne démarre pas

- Vérifier que le port 5173 n'est pas déjà utilisé
- Vérifier les logs dans la console

### Erreur "GitHub API rate limit"

- Vérifier que le GitHub Token est bien configuré
- Le token doit avoir les permissions `repo`

### Le journal est vide

- Vérifier que l'URL du repository est correcte
- Vérifier que le nom d'utilisateur (`me`) correspond à votre username GitHub
- Vérifier que vos commits ont le bon format (durée entre crochets)

## Structure des fichiers

```
electron/
├── main.js                    # Main process Electron
├── preload.js                 # Preload script (IPC bridge)
├── package.json               # Configuration npm
├── server/
│   ├── server.js              # Serveur Express
│   ├── lib/
│   │   ├── settings-manager.js   # Gestion du token
│   │   └── gitj-manager.js       # Gestion des .gitj
│   └── views/                 # Templates EJS
├── assets/
│   └── icon.png               # Icône de l'app
└── example.gitj               # Exemple de projet
```

## Support

Pour rapporter un bug ou demander une fonctionnalité, créez une issue sur GitHub.
