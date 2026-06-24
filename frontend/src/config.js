const getBackendUrl = () => {
  // Check if a production backend URL environment variable is set
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  const hostname = window.location.hostname || 'localhost';

  // Check if running on localhost or a local LAN IP (e.g., 192.168.x.x, 10.x.x.x, 172.16.x.x-172.31.x.x, or 127.0.0.1)
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

  if (isLocal) {
    return `http://${hostname}:3000`;
  }

  // Fallback to the production backend URL for deployed environments (e.g. Vercel)
  // because .env files containing VITE_BACKEND_URL are git-ignored and not uploaded to Vercel.
  return 'https://queuecurebackend.onrender.com';
};

export const BACKEND_URL = getBackendUrl();
export default BACKEND_URL;
