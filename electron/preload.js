const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Gestion des projets
  newProject: () => ipcRenderer.invoke('new-project'),
  openProject: () => ipcRenderer.invoke('open-project'),
  saveProject: () => ipcRenderer.invoke('save-project'),
  getProjectData: () => ipcRenderer.invoke('get-project-data'),
  createProjectWithConfig: (config) => ipcRenderer.invoke('create-project-with-config', config),

  // Gestion des settings
  getGithubToken: () => ipcRenderer.invoke('get-github-token'),
  setGithubToken: (token) => ipcRenderer.invoke('set-github-token', token),
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // Notifications
  onProjectChanged: (callback) => {
    ipcRenderer.on('project-changed', callback);
  },

  // Utilitaires
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
