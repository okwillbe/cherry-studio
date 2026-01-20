import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// assert not supported by biome
// import pkg from './package.json' assert { type: 'json' }
import pkg from './package.json'
//process Node.js 的全局对象 (Global Object) 它非常像 Java 中的 System 类 
// type是变量名不是关键字
const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

//默认导出
export default defineConfig({
  // ==========================================
  // 1. Main Process (主进程) 核心结构体
  // 相当于后端的 "Server" 端，运行 Node.js 环境 类似后端 Server (SpringBoot)
  // ==========================================
  main: {
    plugins: [...visualizerPlugin('main')], // 打包分析插件，用于查看主进程包体积 plugins关键字 用来声明要使用的 Vite 插件 值必须是一个数组
    resolve: { 
      // resolve.alias 路径别名映射，类似 Java 的 import com.company...
      // 让代码中可以使用 @main/xxx 而不是 ../../../main/xxx
      alias: {
        '@main': resolve('src/main'),
        '@types': resolve('src/renderer/src/types'),
        '@shared': resolve('packages/shared'),
        '@logger': resolve('src/main/services/LoggerService'),
        // MCP (Model Context Protocol) 相关的包映射
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
        '@mcp-trace/trace-node': resolve('packages/mcp-trace/trace-node')
      }
    },
    build: { //Vite 配置的内置属性名（关键字）。 控制打包构建行为。
      rollupOptions: { //	Vite 内置关键字 配置对象的属性名
        // 外部依赖配置：告诉打包工具这些包"不要"打进最终的 exe/js 文件里
        // Maven <scope>provided</scope>，运行时由环境提供
        external: ['bufferutil', 'utf-8-validate', 'electron', ...Object.keys(pkg.dependencies)], 
        output: {
          // 下面两个配置是为了强制将主进程代码打包成【单个 JS 文件】
          // 这样做的好处是部署简单，启动时不用加载大量小文件，且避免某些 Electron 环境下的路径查找问题
          manualChunks: undefined, // 禁用自动代码分割
          inlineDynamicImports: true // 将所有 import() 动态导入变成同步代码合并到一个文件中
        },
        // 忽略特定的警告信息（这里忽略了 ESM 和 CommonJS 混用的警告）
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      },
      sourcemap: isDev // 开发环境开启源码映射，方便断点调试；生产环境关闭
    },
    // Esbuild 优化配置：生产环境移除所有注释，减小体积
    esbuild: isProd ? { legalComments: 'none' } : {},
    optimizeDeps: {
      noDiscovery: isDev // 开发模式下不自动发现依赖，加快启动速度
    }
  },

  // ==========================================
  // 2. Preload (预加载脚本) 核心结构体
  // 它是连接 Main 和 Renderer 的桥梁，拥有部分 Node 权限
  // ==========================================
  preload: {
    plugins: [
      react({
        tsDecorators: true // 允许在 TypeScript 中使用装饰器语法（类似 Java 的 @Annotation）
      })
    ],
    resolve: {
      // 预加载脚本需要的别名，通常比主进程少
      alias: {
        '@shared': resolve('packages/shared'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core')
      }
    },
    build: {
      sourcemap: isDev // 同样，仅开发环境开启调试映射
    }
  },

  // ==========================================
  // 3. Renderer Process (渲染进程) 核心结构体
  // 相当于传统的 "前端"，运行 React 页面，Browser 环境
  // ==========================================
  renderer: {
    plugins: [
      // 动态导入 Tailwind CSS 的 Vite 插件（样式框架）
      (async () => (await import('@tailwindcss/vite')).default())(),
      react({
        tsDecorators: true // 支持 React 组件中使用装饰器
      }),
      // 开发环境注入代码检查插件，允许在页面点击组件直接跳转到 IDE 源码
      ...(isDev ? [CodeInspectorPlugin({ bundler: 'vite' })] : []), 
      ...visualizerPlugin('renderer') // 渲染进程的包体积分析
    ],
    resolve: {
      // 前端页面的别名非常多，映射了各个模块和 AI 核心库
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('packages/shared'),
        '@types': resolve('src/renderer/src/types'),
        '@logger': resolve('src/renderer/src/services/LoggerService'),
        // ... 一系列 AI 核心业务包和扩展包的映射
        '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
        '@cherrystudio/extension-table-plus': resolve('packages/extension-table-plus/src'),
        // ... 其他路径
      }
    },
    optimizeDeps: {
      exclude: ['pyodide'], // 排除 pyodide（浏览器端 Python 运行库）的预构建，防止兼容性问题
      esbuildOptions: {
        target: 'esnext' // 开发环境使用最新的 JS 标准，构建速度最快
      }
    },
    worker: {
      format: 'es' // Web Worker 使用 ES Module 格式
    },
    build: {
      target: 'esnext', // 生产构建目标为最新 JS 标准（Chromium 内核支持度很高）
      rollupOptions: {
        // 【关键】多入口配置 (Multi-Page Application)
        // 这说明你的应用不仅仅有一个主窗口，还有很多独立的子窗口或浮窗
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),           // 主窗口
          miniWindow: resolve(__dirname, 'src/renderer/miniWindow.html'), // 迷你悬浮窗
          selectionToolbar: resolve(__dirname, 'src/renderer/selectionToolbar.html'), // 划词工具栏
          selectionAction: resolve(__dirname, 'src/renderer/selectionAction.html'),   // 划词动作页
          traceWindow: resolve(__dirname, 'src/renderer/traceWindow.html')            // 调试/追踪窗口
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      }
    },
    esbuild: isProd ? { legalComments: 'none' } : {}
  }
})
