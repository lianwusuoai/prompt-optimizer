import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import path from 'path'
import { DEFAULT_VITE_ENV } from '../core/src/utils/default-env'
import { createPwaPlugin } from './pwa.config'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const monorepoRoot = resolve(__dirname, '../..')
  const desktopDev = command === 'serve' && process.env.ELECTRON_BUILD === 'true'
  const env = loadEnv(mode, monorepoRoot)
  const processEnv = {
    ...DEFAULT_VITE_ENV,
    ...env,
  }

  return {
    envDir: monorepoRoot,
    plugins: [vue(), createPwaPlugin()],
    css: desktopDev ? { postcss: resolve(__dirname, '../ui') } : undefined,
    server: {
      port: 18181,
      strictPort: desktopDev,
      host: true,
      fs: {
        // 允许为工作区依赖提供服务
        allow: desktopDev ? ['..', resolve(monorepoRoot, 'node_modules')] : ['..']
      },
      hmr: true,
      watch: {
        // 确保监视monorepo中其他包的变化
        ignored: ['!**/node_modules/@prompt-optimizer/**']
      }
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        }
      }
    },
    publicDir: 'public',
    resolve: {
      preserveSymlinks: !desktopDev,
      dedupe: desktopDev ? ['vue'] : [],
      alias: {
        '@': resolve(__dirname, 'src'),
        // Rebuilding a library clears dist while the open desktop window is serving requests.
        ...(desktopDev ? {
          '@prompt-optimizer/ui/dist/style.css': resolve(__dirname, '../ui/src/styles/index.css'),
          '@prompt-optimizer/ui': resolve(__dirname, '../ui/src/index.ts'),
          '@prompt-optimizer/core/bridge-protocol': resolve(__dirname, '../core/src/bridge-protocol.ts'),
          '@prompt-optimizer/core': resolve(__dirname, '../core/src/index.ts'),
        } : {
          '@prompt-optimizer/ui': resolve(__dirname, '../ui'),
          '@prompt-optimizer/core': resolve(__dirname, '../core'),
        }),
        '@prompt-optimizer/web': path.resolve(__dirname, '../web'),
        '@prompt-optimizer/extension': path.resolve(__dirname, '../extension')
      }
    },
    define: {
      'process.env': {
        NODE_ENV: JSON.stringify(process.env.NODE_ENV || 'development'),
        ...Object.keys(processEnv).reduce((acc, key) => {
          acc[key] = processEnv[key as keyof typeof processEnv]
          return acc
        }, {} as Record<string, string>)
      }
    }
  }
})
