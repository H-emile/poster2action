import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 用 .mjs 而不是 .ts：Vite 8 打包 .ts 配置时会调 rolldown 的 externalize-deps，
 * 在受限环境下会 spawn EPERM。纯 ESM 配置 + --configLoader native 可以绕开这一步。
 *
 * 视觉模型走本地代理：key 只出现在 Node 这一侧（从 .env.local 读），
 * 前端只知道「/api/llm」这个路径，浏览器里看不到 key。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.SILICONFLOW_API_KEY || '';
  const mock = env.VISION_MOCK === '1';
  const wanted = env.VISION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
  // 模拟模式下允许指定 mock-ocr / mock-json，用来分别验证两条界面分支
  const model = mock ? (/^mock/i.test(wanted) ? wanted : 'mock-ocr') : wanted;
  const base = env.SILICONFLOW_BASE || 'https://api.siliconflow.cn';

  return {
    // 相对路径：打包后从任何子目录打开都能加载资源
    base: './',
    plugins: [
      react(),
      {
        name: 'vision-proxy-health',
        configureServer(server) {
          // 前端先问一句「有没有配好」：没有 key 就不显示按钮，而不是点了才报错
          server.middlewares.use('/api/llm/health', (_req, res) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            // 模拟模式不需要 key：用来在没有额度时验证界面与流程
            res.end(JSON.stringify({ ok: mock || Boolean(apiKey), model, mock }));
          });
        },
      },
    ],
    server: {
      port: 5180,
      proxy: {
        '/api/llm': {
          target: base,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/llm/, ''),
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        },
      },
    },
  };
});
