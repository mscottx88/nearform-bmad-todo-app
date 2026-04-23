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
  // Deep decamelize so nested camelCase keys inside arrays / nested
  // objects also flip to snake_case. Required for story 4-8's
  // `PATCH /api/todos/positions` whose payload nests `positionX` /
  // `positionY` inside `positions[]` — a shallow transform left them
  // unchanged and the backend's pydantic model rejected the body
  // with a 422. Symmetric with the response interceptor's deep
  // camelizeKeys.
  data: cfg.data
    ? decamelizeKeys(cfg.data as Record<string, unknown>, { deep: true })
    : cfg.data,
}));

export default apiClient;
