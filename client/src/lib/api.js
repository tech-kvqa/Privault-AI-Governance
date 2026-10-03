import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'https://privault-ai-governance.onrender.com',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('privault_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      ['privault_token', 'privault_user', 'privault_permissions', 'privault_restricted'].forEach((k) => localStorage.removeItem(k));
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
