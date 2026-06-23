const getBackendUrl = () => {
  // Check if a production backend URL environment variable is set
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  // Local LAN development/offline default
  const hostname = window.location.hostname || 'localhost';
  return `http://${hostname}:3000`;
};

export const BACKEND_URL = getBackendUrl();
export default BACKEND_URL;
