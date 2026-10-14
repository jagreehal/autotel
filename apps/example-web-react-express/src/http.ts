import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8081',
});

api.interceptors.request.use((config) => {
  config.headers.set('applicationToken', 'demo-token');
  if (!(config.data instanceof FormData))
    config.headers.set('Content-Type', 'application/json');
  return config;
});
