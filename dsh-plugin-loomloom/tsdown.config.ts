import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    name: 'dsh-plugin-loomloom',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
  },
  {
    name: 'dsh-plugin-loomloom/client',
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    dts: false,
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-locale/client',
      '@deepseek-ai/dsh-client-ui-layout/client',
      '@deepseek-ai/dsh-client-ui-renderer/client',
      '@deepseek-ai/dsh-client-ui-settings/client',
      '@deepseek-ai/dsh-client-ui-slots',
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-loomloom", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
