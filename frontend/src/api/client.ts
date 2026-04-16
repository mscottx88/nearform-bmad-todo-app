import axios, { type AxiosError } from 'axios';
import camelcaseKeys from 'camelcase-keys';
import decamelizeKeys from 'decamelize-keys';

// Hardcoded to `/api` so Vite proxies to the backend in dev and a reverse
// proxy can serve both from the same origin in prod. Avoids MSYS path-mangling
// on Git Bash for Windows, which corrupts `/api` env values into
// `C:/Program Files/Git/api`.
const apiClient = axios.create({
  baseURL: '/api',
});

apiClient.interceptors.response.use(
  (res) => {
    res.data = camelcaseKeys(res.data as Record<string, unknown>, { deep: true });
    return res;
  },
  (error: AxiosError) => {
    if (error.response?.data) {
      error.response.data = camelcaseKeys(
        error.response.data as Record<string, unknown>,
        { deep: true },
      );
    }
    return Promise.reject(error);
  },
);

apiClient.interceptors.request.use((cfg) => ({
  ...cfg,
  data: cfg.data ? decamelizeKeys(cfg.data as Record<string, unknown>) : cfg.data,
}));

export default apiClient;
