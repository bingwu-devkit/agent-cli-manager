import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  // core 只在工作区内使用，发布时将其实现合并到 CLI。
  deps: {
    alwaysBundle: ['@agent-cli-manager/core'],
    neverBundle: ['proper-lockfile', 'semver', 'zod'],
  },
  dts: false,
  entry: ['src/cli.ts'],
  format: ['esm'],
  minify: false,
  publint: true,
  sourcemap: true,
})
