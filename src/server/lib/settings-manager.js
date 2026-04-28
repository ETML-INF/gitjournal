import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

// Chemin vers le fichier settings.json dans userData
let settingsPath = null;

/**
 * Initialise le chemin du fichier settings
 * Doit être appelé après que app soit ready
 */
export function initSettingsPath() {
  const userDataPath = app.getPath('userData');
  settingsPath = path.join(userDataPath, 'settings.json');
}

/**
 * Charge les settings depuis le fichier
 * Retourne un objet avec les settings par défaut si le fichier n'existe pas
 */
export async function loadSettings() {
  if (!settingsPath) {
    throw new Error('Settings path not initialized. Call initSettingsPath() first.');
  }

  try {
    const data = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Si le fichier n'existe pas, retourner les settings par défaut
    if (error.code === 'ENOENT') {
      return {
        githubToken: null,
        lastOpenedFile: null
      };
    }
    throw error;
  }
}

/**
 * Sauvegarde les settings dans le fichier
 */
export async function saveSettings(settings) {
  if (!settingsPath) {
    throw new Error('Settings path not initialized. Call initSettingsPath() first.');
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Retourne le GitHub Token
 */
export async function getGithubToken() {
  const settings = await loadSettings();
  return settings.githubToken || null;
}

/**
 * Définit le GitHub Token
 */
export async function setGithubToken(token) {
  const settings = await loadSettings();
  settings.githubToken = token;
  await saveSettings(settings);
}

/**
 * Retourne le chemin du dernier fichier ouvert
 */
export async function getLastOpenedFile() {
  const settings = await loadSettings();
  return settings.lastOpenedFile || null;
}

/**
 * Mémorise le chemin du dernier fichier ouvert
 */
export async function setLastOpenedFile(filePath) {
  const settings = await loadSettings();
  settings.lastOpenedFile = filePath;
  await saveSettings(settings);
}
