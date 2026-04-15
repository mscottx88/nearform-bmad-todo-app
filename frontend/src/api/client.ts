import axios, { type AxiosError } from 'axios';
import camelcaseKeys from 'camelcase-keys';
import decamelizeKeys from 'decamelize-keys';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
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
