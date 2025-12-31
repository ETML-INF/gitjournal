import fs from 'fs/promises';

/**
 * Charge un fichier .gitj et retourne l'objet projet
 * @param {string} filePath - Chemin vers le fichier .gitj
 * @returns {Promise<Object>} - L'objet projet
 */
export async function loadProject(filePath) {
  const data = await fs.readFile(filePath, 'utf-8');
  const project = JSON.parse(data);

  // Valider la structure
  validateProject(project);

  return project;
}

/**
 * Sauvegarde un objet projet dans un fichier .gitj
 * @param {string} filePath - Chemin vers le fichier .gitj
 * @param {Object} projectData - L'objet projet à sauvegarder
 */
export async function saveProject(filePath, projectData) {
  // Valider avant de sauvegarder
  validateProject(projectData);

  await fs.writeFile(filePath, JSON.stringify(projectData, null, 2), 'utf-8');
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
