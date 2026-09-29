import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 单元测试配置。
 * 测试只覆盖纯逻辑模块，例如加密、标签渲染、上下文裁剪、后续处理解析与路径构造，
 * 不触碰数据库与文件系统，保证测试可以快速且可重复地运行。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
});
