import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { app as expressApp, setProjectData, onProjectChange } from './server/server.js';
import {
  initSettingsPath,
  getGithubToken,
  setGithubToken,
  getLastOpenedFile,
  setLastOpenedFile
} from './server/lib/settings-manager.js';
import {
  loadProject,
  saveProject,
  createNewProject
} from './server/lib/gitj-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Variables globales
let mainWindow = null;
let expressServer = null;
let currentProjectPath = null;
let currentProjectData = null;

const PORT = 5173;
const SERVER_URL = `http://localhost:${PORT}`;

// === GESTION DES PROJETS ===

/**
 * Ouvre un fichier .gitj
 */
async function openProject(filePath) {
  try {
    // Si pas de chemin fourni, afficher un dialog
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Ouvrir un projet GitJournal',
        filters: [{ name: 'GitJournal Project', extensions: ['gitj'] }],
        properties: ['openFile']
      });

      if (result.canceled || !result.filePaths.length) {
        return null;
      }

      filePath = result.filePaths[0];
    }

    // Charger le projet
    const projectData = await loadProject(filePath);

    // Mémoriser le projet
    currentProjectPath = filePath;
    currentProjectData = projectData;
    await setLastOpenedFile(filePath);

    // Injecter les données dans le serveur Express
    const token = await getGithubToken();
    setProjectData(projectData, token);

    // Rafraîchir la fenêtre
    if (mainWindow) {
      mainWindow.reload();
    }

    return filePath;
  } catch (error) {
    dialog.showErrorBox('Erreur d\'ouverture', `Impossible d'ouvrir le projet: ${error.message}`);
    return null;
  }
}

/**
 * Ouvre la fenêtre de configuration pour un nouveau projet
 */
let newProjectWindow = null;

async function newProject() {
  // Ne créer qu'une seule fenêtre à la fois
  if (newProjectWindow) {
    newProjectWindow.focus();
    return;
  }

  newProjectWindow = new BrowserWindow({
    width: 700,
    height: 600,
    parent: mainWindow,
    modal: false, // Pas modale pour permettre les dialogs
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  newProjectWindow.loadFile(path.join(__dirname, 'new-project.html'));

  // DevTools en mode développement
  if (process.env.NODE_ENV === 'development') {
    newProjectWindow.webContents.openDevTools();
  }

  newProjectWindow.on('closed', () => {
    newProjectWindow = null;
  });
}

/**
 * Crée un nouveau projet avec la configuration fournie
 */
async function createProjectWithConfig(config) {
  try {
    // Dialog pour choisir où sauvegarder le nouveau projet
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Enregistrer le nouveau projet',
      defaultPath: `${config.projectName.toLowerCase().replace(/\s+/g, '-')}.gitj`,
      filters: [{ name: 'GitJournal Project', extensions: ['gitj'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const filePath = result.filePath;

    // Créer le projet avec la configuration fournie
    const projectData = {
      repoUrl: config.repoUrl,
      projectName: config.projectName,
      branch: config.branch || 'main',
      me: config.me,
      journalStartDate: config.journalStartDate || null,
      exceptions: []
    };

    // Sauvegarder le projet
    await saveProject(filePath, projectData);

    // Fermer la fenêtre de configuration
    if (newProjectWindow) {
      newProjectWindow.close();
    }

    // Charger le nouveau projet
    await openProject(filePath);

    return filePath;
  } catch (error) {
    console.error('Erreur dans createProjectWithConfig:', error);
    dialog.showErrorBox('Erreur de création', `Impossible de créer le projet: ${error.message}`);
    return null;
  }
}

/**
 * Sauvegarde le projet actuel
 */
async function saveCurrentProject() {
  if (!currentProjectPath || !currentProjectData) {
    return false;
  }

  try {
    await saveProject(currentProjectPath, currentProjectData);
    return true;
  } catch (error) {
    dialog.showErrorBox('Erreur de sauvegarde', `Impossible de sauvegarder le projet: ${error.message}`);
    return false;
  }
}

// === EXPORT PDF ===

async function exportToPDF() {
  if (!mainWindow) return;

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter en PDF',
    defaultPath: `journal-${new Date().toISOString().split('T')[0]}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (canceled || !filePath) return;

  try {
    const pdfData = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: true,
      margins: {
        top: 0.4,    // ~1 cm (marges en pouces)
        bottom: 0.4,
        left: 0.4,
        right: 0.4
      }
    });

    const fs = await import('fs/promises');
    await fs.writeFile(filePath, pdfData);

    // Demander si l'utilisateur veut ouvrir le PDF
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Export réussi',
      message: 'Le PDF a été exporté avec succès.',
      buttons: ['OK', 'Ouvrir le fichier'],
      defaultId: 0
    });

    if (response === 1) {
      shell.openPath(filePath);
    }
  } catch (error) {
    dialog.showErrorBox('Erreur d\'export', error.message);
  }
}

// === FENÊTRE DE SETTINGS ===

let settingsWindow = null;

function openSettingsWindow() {
  // Ne créer qu'une seule fenêtre de settings
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 400,
    parent: mainWindow,
    modal: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  // DevTools en mode développement
  if (process.env.NODE_ENV === 'development') {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// === IPC HANDLERS ===

function setupIpcHandlers() {
  ipcMain.handle('new-project', async () => {
    return await newProject();
  });

  ipcMain.handle('open-project', async () => {
    return await openProject();
  });

  ipcMain.handle('save-project', async () => {
    return await saveCurrentProject();
  });

  ipcMain.handle('get-project-data', () => {
    return currentProjectData;
  });

  ipcMain.handle('create-project-with-config', async (event, config) => {
    return await createProjectWithConfig(config);
  });

  ipcMain.handle('get-github-token', async () => {
    return await getGithubToken();
  });

  ipcMain.handle('set-github-token', async (event, token) => {
    await setGithubToken(token);
    // Mettre à jour le serveur Express si un projet est ouvert
    if (currentProjectData) {
      setProjectData(currentProjectData, token);
      if (mainWindow) {
        mainWindow.reload();
      }
    }
    return true;
  });

  ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
  });
}

// === SERVEUR EXPRESS ===

async function startExpressServer() {
  return new Promise((resolve, reject) => {
    try {
      expressServer = expressApp.listen(PORT, () => {
        console.log(`Express server started on port ${PORT}`);
        resolve();
      });

      expressServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use`);
        }
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// === FENÊTRE PRINCIPALE ===

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadURL(`${SERVER_URL}/jdt`);

  // DevTools en mode développement
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// === MENU APPLICATION ===

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const menuTemplate = [
    // Menu macOS spécifique
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: 'À propos de GitJournal' },
        { type: 'separator' },
        {
          label: 'Préférences...',
          accelerator: 'Cmd+,',
          click: () => {
            openSettingsWindow();
          }
        },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer GitJournal' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter GitJournal' }
      ]
    }] : []),

    // Menu Fichier
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Nouveau projet',
          accelerator: 'CmdOrCtrl+N',
          click: async () => {
            await newProject();
          }
        },
        {
          label: 'Ouvrir projet',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            await openProject();
          }
        },
        {
          label: 'Enregistrer',
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            await saveCurrentProject();
          }
        },
        { type: 'separator' },
        {
          label: 'Exporter en PDF',
          accelerator: 'CmdOrCtrl+E',
          click: async () => {
            await exportToPDF();
          }
        },
        {
          label: 'Imprimer',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.print();
            }
          }
        },
        { type: 'separator' },
        ...(!isMac ? [{
          label: 'Préférences',
          click: () => {
            openSettingsWindow();
          }
        }] : []),
        ...(!isMac ? [{ type: 'separator' }] : []),
        ...(!isMac ? [{ role: 'quit', label: 'Quitter' }] : [])
      ]
    },

    // Menu Édition
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },

    // Menu Affichage
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Actualiser' },
        { role: 'forceReload', label: 'Forcer l\'actualisation' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom par défaut' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' }
      ]
    },

    // Menu Développement
    {
      label: 'Développement',
      submenu: [
        { role: 'toggleDevTools', label: 'Outils de développement' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// === CYCLE DE VIE DE L'APP ===

app.on('ready', async () => {
  try {
    // Initialiser le chemin des settings
    initSettingsPath();

    // Charger le token GitHub
    const token = await getGithubToken();

    // Tenter de charger le dernier projet ouvert
    const lastFile = await getLastOpenedFile();
    if (lastFile) {
      try {
        const projectData = await loadProject(lastFile);
        currentProjectPath = lastFile;
        currentProjectData = projectData;
        setProjectData(projectData, token);
      } catch (error) {
        console.log('Could not load last project:', error.message);
        // Pas grave, on démarre sans projet
      }
    }

    // Setup du callback pour les changements de projet
    onProjectChange(async (updatedProject) => {
      currentProjectData = updatedProject;
      // Auto-save
      await saveCurrentProject();
    });

    // Setup IPC handlers
    setupIpcHandlers();

    // Démarrer le serveur Express
    await startExpressServer();

    // Créer la fenêtre et le menu
    createMainWindow();
    createApplicationMenu();

  } catch (error) {
    dialog.showErrorBox('Erreur de démarrage', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (expressServer) {
    expressServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

app.on('before-quit', async () => {
  // Sauvegarder le projet avant de quitter
  if (currentProjectPath && currentProjectData) {
    await saveCurrentProject();
  }

  if (expressServer) {
    expressServer.close();
  }
});
