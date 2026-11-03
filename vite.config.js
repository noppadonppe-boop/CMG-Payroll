import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fetchZkAttendance, readZkConfig, validateRange } from './functions/zkteco.js';

// Local stand-in for the `zktecoApi` Cloud Function so `npm run dev` works without
// deploying. Credentials come from the non-VITE_ ZK_* entries in .env.
const zktecoDevApi = (env) => ({
  name: 'zkteco-dev-api',
  configureServer(server) {
    server.middlewares.use('/api/zkteco', async (request, response) => {
      const send = (status, body) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); };
      try {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const startDate = query.get('startDate');
        const endDate = query.get('endDate');
        if (!validateRange(startDate, endDate)) { send(400, { error: 'ช่วงวันที่ไม่ถูกต้อง' }); return; }
        send(200, await fetchZkAttendance({ config: readZkConfig(env), startDate, endDate }));
      } catch (error) {
        send(502, { error: error.message });
      }
    });
  },
});

// ZK_DEV_PROXY_URL (e.g. https://cmg-payroll.web.app) forwards /api/zkteco to the deployed
// Cloud Function, which is useful when this machine cannot reach ZKBioTime directly. The
// browser's Firebase ID token is passed through, so the function still checks the user.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyUrl = env.ZK_DEV_PROXY_URL;
  return {
    plugins: [react(), ...(proxyUrl ? [] : [zktecoDevApi(env)])],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: proxyUrl ? { '/api/zkteco': { target: proxyUrl, changeOrigin: true } } : undefined,
    },
  };
});
