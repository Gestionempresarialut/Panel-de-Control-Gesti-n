/* Configuración del Panel de control.
   Si el repositorio cambia de nombre o de cuenta, actualiza estos datos. */
const PANEL_CONFIG = {
  owner: "Gestionempresarialut",              // Cuenta u organización de GitHub
  repo: "Panel-de-Control-Gesti-n",           // Nombre del repositorio
  branch: "main",                             // Rama publicada
  api: "https://api.github.com",              // API de GitHub (no cambiar)
  zipFolder: "gestion-empresarial-utcancun",  // Nombre de la carpeta dentro del ZIP
  excluir: ["panel/", ".github/", ".nojekyll"] // Lo que NO va en el ZIP para el servidor
};
