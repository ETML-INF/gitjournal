import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Charge un fichier .gitj et retourne l'objet projet
 * @param {string} filePath - Chemin vers le fichier .gitj
 * @returns {Promise<Object>} - L'objet projet
 */
export async function loadProject(filePath) {
  const data = await fs.readFile(filePath, 'utf-8');

  // Vérifier que le fichier n'est pas vide
  if (!data || data.trim().length === 0) {
    throw new Error('Le fichier .gitj est vide ou corrompu');
  }

  const project = JSON.parse(data);

  // Valider la structure
  validateProject(project);

  return project;
}

/**
 * Sauvegarde un objet projet dans un fichier .gitj de manière atomique
 * @param {string} filePath - Chemin vers le fichier .gitj
 * @param {Object} projectData - L'objet projet à sauvegarder
 */
export async function saveProject(filePath, projectData) {
  // Valider avant de sauvegarder
  validateProject(projectData);

  // Sérialiser les données
  const jsonData = JSON.stringify(projectData, null, 2);

  // Vérifier que les données ne sont pas vides
  if (!jsonData || jsonData.trim().length === 0) {
    throw new Error('Impossible de sauvegarder un projet vide');
  }

  // Écriture atomique : écrire dans un fichier temporaire puis renommer
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);
  const tempPath = path.join(os.tmpdir(), `${filename}.${Date.now()}.tmp`);

  try {
    // Écrire dans le fichier temporaire
    await fs.writeFile(tempPath, jsonData, 'utf-8');

    // Vérifier que le fichier temporaire a été écrit correctement
    const stats = await fs.stat(tempPath);
    if (stats.size === 0) {
      throw new Error('Le fichier temporaire est vide après écriture');
    }

    // Vérifier que les données sont valides en relisant
    const writtenData = await fs.readFile(tempPath, 'utf-8');
    JSON.parse(writtenData); // Valider que c'est du JSON valide

    // Renommer atomiquement (remplace le fichier existant)
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Nettoyer le fichier temporaire en cas d'erreur
    try {
      await fs.unlink(tempPath);
    } catch (e) {
      // Ignorer l'erreur de nettoyage
    }
    throw new Error(`Erreur lors de la sauvegarde atomique: ${error.message}`);
  }
}

/**
 * Crée un nouvel objet projet vide
 * @returns {Object} - Un objet projet vide avec les champs par défaut
 */
export function createNewProject() {
  return {
    repoUrl: "",
    projectName: "",
    branch: "main",
    me: "",
    journalStartDate: null,
    exceptions: []
  };
}

/**
 * Ajoute une exception au projet
 * @param {Object} projectData - L'objet projet
 * @param {Object} exception - L'exception à ajouter
 * @returns {Object} - L'exception ajoutée (avec id généré)
 */
export function addException(projectData, exception) {
  if (!projectData.exceptions) {
    projectData.exceptions = [];
  }

  // Générer un ID si nécessaire
  if (!exception.id) {
    exception.id = crypto.randomUUID();
  }

  projectData.exceptions.push(exception);
  return exception;
}

/**
 * Met à jour une exception existante
 * @param {Object} projectData - L'objet projet
 * @param {string} exceptionId - L'ID de l'exception à mettre à jour
 * @param {Object} updates - Les champs à mettre à jour
 * @returns {Object|null} - L'exception mise à jour ou null si non trouvée
 */
export function updateException(projectData, exceptionId, updates) {
  if (!projectData.exceptions) {
    return null;
  }

  const exception = projectData.exceptions.find(e => e.id === exceptionId);
  if (!exception) {
    return null;
  }

  Object.assign(exception, updates);
  return exception;
}

/**
 * Retourne le tableau des exceptions
 * @param {Object} projectData - L'objet projet
 * @returns {Array} - Le tableau des exceptions
 */
export function getExceptions(projectData) {
  return projectData.exceptions || [];
}

/**
 * Valide la structure d'un objet projet
 * Lance une erreur si la structure est invalide
 * @param {Object} projectData - L'objet projet à valider
 */
export function validateProject(projectData) {
  if (!projectData || typeof projectData !== 'object') {
    throw new Error('Invalid project: must be an object');
  }

  // Les champs peuvent être vides mais doivent exister
  const requiredFields = ['repoUrl', 'projectName', 'branch', 'me', 'exceptions'];
  for (const field of requiredFields) {
    if (!(field in projectData)) {
      throw new Error(`Invalid project: missing field '${field}'`);
    }
  }

  // Valider que exceptions est un tableau
  if (!Array.isArray(projectData.exceptions)) {
    throw new Error('Invalid project: exceptions must be an array');
  }

  // journalStartDate est optionnel mais doit être null ou une string si présent
  if ('journalStartDate' in projectData) {
    if (projectData.journalStartDate !== null && typeof projectData.journalStartDate !== 'string') {
      throw new Error('Invalid project: journalStartDate must be null or a string');
    }
  }
}
