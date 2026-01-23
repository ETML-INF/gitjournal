import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { app as expressApp, setProjectData, onProjectChange } from "./server/server.js";
import {
  initSettingsPath,
  getGithubToken,
  setGithubToken,
  getLastOpenedFile,
  setLastOpenedFile
} from "./server/lib/settings-manager.js";
import { loadProject, saveProject, createNewProject } from "./server/lib/gitj-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Variables globales
let mainWindow = null;
let expressServer = null;
let currentProjectPath = null;
let currentProjectData = null;
let fileToOpenAtStartup = null; // Fichier passé en argument ou via open-file
let saveTimeout = null; // Pour le debounce de sauvegarde
let isSaving = false; // Flag pour éviter les sauvegardes simultanées

let serverPort = 0; // Will be assigned dynamically
const getServerUrl = () => `http://localhost:${serverPort}`;

// === GESTION DES PROJETS ===

/**
 * Ouvre un fichier .gitj
 */
async function openProject(filePath) {
  try {
    // Si pas de chemin fourni, afficher un dialog
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Ouvrir un projet GitJournal",
        filters: [{ name: "GitJournal Project", extensions: ["gitj"] }],
        properties: ["openFile"]
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

    // Mettre à jour le titre de la fenêtre
    if (mainWindow) {
      const title = `Journal de travail - ${projectData.me} - ${projectData.projectName}`;
      mainWindow.setTitle(title);
      mainWindow.reload();
    }

    return filePath;
  } catch (error) {
    dialog.showErrorBox("Erreur d'ouverture", `Impossible d'ouvrir le projet: ${error.message}`);
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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  newProjectWindow.loadFile(path.join(__dirname, "new-project.html"));

  // DevTools en mode développement
  if (process.env.NODE_ENV === "development") {
    newProjectWindow.webContents.openDevTools();
  }

  newProjectWindow.on("closed", () => {
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
      title: "Enregistrer le nouveau projet",
      defaultPath: `${config.projectName.toLowerCase().replace(/\s+/g, "-")}.gitj`,
      filters: [{ name: "GitJournal Project", extensions: ["gitj"] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const filePath = result.filePath;

    // Créer le projet avec la configuration fournie
    const projectData = {
      repoUrl: config.repoUrl,
      projectName: config.projectName,
      branch: config.branch || "main",
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
    console.error("Erreur dans createProjectWithConfig:", error);
    dialog.showErrorBox("Erreur de création", `Impossible de créer le projet: ${error.message}`);
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

  // Éviter les sauvegardes simultanées
  if (isSaving) {
    console.log('Sauvegarde déjà en cours, ignorée');
    return false;
  }

  try {
    isSaving = true;

    // Valider que les données ne sont pas vides avant de sauvegarder
    if (!currentProjectData || Object.keys(currentProjectData).length === 0) {
      console.error('Tentative de sauvegarde de données vides - ignorée');
      return false;
    }

    console.log(`Sauvegarde du projet: ${currentProjectPath}`);
    await saveProject(currentProjectPath, currentProjectData);
    console.log('Sauvegarde réussie');
    return true;
  } catch (error) {
    console.error('Erreur de sauvegarde:', error);
    dialog.showErrorBox("Erreur de sauvegarde", `Impossible de sauvegarder le projet: ${error.message}`);
    return false;
  } finally {
    isSaving = false;
  }
}

/**
 * Sauvegarde avec debounce pour éviter trop de sauvegardes
 */
function debouncedSave() {
  // Annuler la sauvegarde précédente si elle n'a pas encore eu lieu
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  // Programmer une nouvelle sauvegarde dans 500ms
  saveTimeout = setTimeout(async () => {
    await saveCurrentProject();
    saveTimeout = null;
  }, 500);
}

// === EXPORT PDF ===

async function exportToPDF() {
  if (!mainWindow) return;

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: "Exporter en PDF",
    defaultPath: `journal-${new Date().toISOString().split("T")[0]}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });

  if (canceled || !filePath) return;

  try {
    const pdfData = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      landscape: true,
      margins: {
        top: 0.4, // ~1 cm (marges en pouces)
        bottom: 0.4,
        left: 0.4,
        right: 0.4
      }
    });

    const fs = await import("fs/promises");
    await fs.writeFile(filePath, pdfData);

    // Demander si l'utilisateur veut ouvrir le PDF
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Export réussi",
      message: "Le PDF a été exporté avec succès.",
      buttons: ["OK", "Ouvrir le fichier"],
      defaultId: 0
    });

    if (response === 1) {
      shell.openPath(filePath);
    }
  } catch (error) {
    dialog.showErrorBox("Erreur d'export", error.message);
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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, "settings.html"));

  // DevTools en mode développement
  if (process.env.NODE_ENV === "development") {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// === IPC HANDLERS ===

function setupIpcHandlers() {
  ipcMain.handle("new-project", async () => {
    return await newProject();
  });

  ipcMain.handle("open-project", async () => {
    return await openProject();
  });

  ipcMain.handle("save-project", async () => {
    return await saveCurrentProject();
  });

  ipcMain.handle("get-project-data", () => {
    return currentProjectData;
  });

  ipcMain.handle("create-project-with-config", async (event, config) => {
    return await createProjectWithConfig(config);
  });

  ipcMain.handle("get-github-token", async () => {
    return await getGithubToken();
  });

  ipcMain.handle("set-github-token", async (event, token) => {
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

  ipcMain.handle("open-external", async (event, url) => {
    await shell.openExternal(url);
  });
}

// === SERVEUR EXPRESS ===

async function startExpressServer() {
  return new Promise((resolve, reject) => {
    try {
      // Use port 0 to get an automatically assigned free port
      expressServer = expressApp.listen(0, () => {
        serverPort = expressServer.address().port;
        console.log(`Express server started on port ${serverPort}`);
        resolve();
      });

      expressServer.on("error", (error) => {
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
    title: "Journal de travail",
    autoHideMenuBar: false, // Toujours afficher le menu sur Windows/Linux
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, "assets", "icon.png")
  });

  mainWindow.loadURL(`${getServerUrl()}/jdt`);

  // DevTools en mode développement
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  // Mettre à jour le titre une fois que la page est chargée
  mainWindow.webContents.on("did-finish-load", () => {
    if (currentProjectData && mainWindow) {
      const title = `Journal de travail - ${currentProjectData.me} - ${currentProjectData.projectName}`;
      mainWindow.setTitle(title);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// === MENU APPLICATION ===

function createApplicationMenu() {
  const isMac = process.platform === "darwin";

  const menuTemplate = [
    // Menu macOS spécifique
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about", label: "À propos de GitJournal" },
              { type: "separator" },
              {
                label: "Préférences...",
                accelerator: "Cmd+,",
                click: () => {
                  openSettingsWindow();
                }
              },
              { type: "separator" },
              { role: "services", label: "Services" },
              { type: "separator" },
              { role: "hide", label: "Masquer GitJournal" },
              { role: "hideOthers", label: "Masquer les autres" },
              { role: "unhide", label: "Tout afficher" },
              { type: "separator" },
              { role: "quit", label: "Quitter GitJournal" }
            ]
          }
        ]
      : []),

    // Menu Fichier
    {
      label: "Fichier",
      submenu: [
        {
          label: "Nouveau projet",
          accelerator: "CmdOrCtrl+N",
          click: async () => {
            await newProject();
          }
        },
        {
          label: "Ouvrir projet",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            await openProject();
          }
        },
        {
          label: "Enregistrer",
          accelerator: "CmdOrCtrl+S",
          click: async () => {
            await saveCurrentProject();
          }
        },
        { type: "separator" },
        {
          label: "Exporter en PDF",
          accelerator: "CmdOrCtrl+E",
          click: async () => {
            await exportToPDF();
          }
        },
        {
          label: "Imprimer",
          accelerator: "CmdOrCtrl+P",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.print();
            }
          }
        },
        { type: "separator" },
        ...(!isMac
          ? [
              {
                label: "Préférences",
                click: () => {
                  openSettingsWindow();
                }
              }
            ]
          : []),
        ...(!isMac ? [{ type: "separator" }] : []),
        ...(!isMac ? [{ role: "quit", label: "Quitter" }] : [])
      ]
    },

    // Menu Édition
    {
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Rétablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" }
      ]
    },

    // Menu Affichage
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Actualiser" },
        { role: "forceReload", label: "Forcer l'actualisation" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom par défaut" },
        { role: "zoomIn", label: "Zoom avant" },
        { role: "zoomOut", label: "Zoom arrière" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" }
      ]
    },

    // Menu Développement (uniquement en mode développement)
    ...(process.env.NODE_ENV === "development"
      ? [
          {
            label: "Développement",
            submenu: [{ role: "toggleDevTools", label: "Outils de développement" }]
          }
        ]
      : [])
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// === CYCLE DE VIE DE L'APP ===

// Vérifier si un fichier .gitj a été passé en argument (Windows/Linux)
if (process.argv.length >= 2) {
  const arg = process.argv.find(arg => arg.endsWith('.gitj'));
  if (arg) {
    fileToOpenAtStartup = arg;
  }
}

// Gérer l'ouverture de fichier sur macOS
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (filePath.endsWith('.gitj')) {
    if (!mainWindow) {
      // L'app n'est pas encore prête, on stocke le fichier
      fileToOpenAtStartup = filePath;
    } else {
      // L'app est prête, on ouvre directement
      openProject(filePath);
    }
  }
});

app.on("ready", async () => {
  try {
    // Initialiser le chemin des settings
    initSettingsPath();

    // Charger le token GitHub
    const token = await getGithubToken();

    // Déterminer quel fichier ouvrir
    let fileToOpen = fileToOpenAtStartup; // Priorité au fichier passé en argument

    if (!fileToOpen) {
      // Sinon, charger le dernier projet ouvert
      fileToOpen = await getLastOpenedFile();
    }

    if (fileToOpen) {
      try {
        const projectData = await loadProject(fileToOpen);
        currentProjectPath = fileToOpen;
        currentProjectData = projectData;
        setProjectData(projectData, token);
      } catch (error) {
        console.log("Could not load project:", error.message);
        // Pas grave, on démarre sans projet
      }
    }

    // Setup du callback pour les changements de projet
    onProjectChange((updatedProject) => {
      currentProjectData = updatedProject;
      // Auto-save avec debounce pour éviter trop de sauvegardes
      debouncedSave();
    });

    // Setup IPC handlers
    setupIpcHandlers();

    // Démarrer le serveur Express
    await startExpressServer();

    // Créer la fenêtre et le menu
    createMainWindow();
    createApplicationMenu();
  } catch (error) {
    dialog.showErrorBox("Erreur de démarrage", error.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (expressServer) {
    expressServer.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

app.on("before-quit", async () => {
  // Annuler toute sauvegarde en attente
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  // Attendre la fin de toute sauvegarde en cours
  while (isSaving) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Sauvegarder le projet une dernière fois avant de quitter
  if (currentProjectPath && currentProjectData) {
    console.log('Sauvegarde finale avant fermeture de l\'application');
    await saveCurrentProject();
  }

  if (expressServer) {
    expressServer.close();
  }
});
