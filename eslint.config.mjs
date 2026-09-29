import next from 'eslint-config-next';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * ESLint 扁平配置。
 * Next 官方配置提供 React、Hooks、Accessibility 与 TypeScript 规则，
 * 这里在其之上追加项目自己的约束。
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'data/**',
      'novel/**',
      'coverage/**',
      'next-env.d.ts',
      // 本地探针与临时产物不入 lint 范围，项目记忆文件保留但同样不参与检查
      '.workbuddy/**',
    ],
  },
  ...next,
  ...nextTypescript,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      // 页面数据来自本机接口与文件系统，挂载时通过 useEffect 触发一次异步加载，
      // setState 发生在 await 之后，并非同步级联渲染，该规则在此场景属于误报。
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/lib/db/**/*.ts', 'src/lib/store/**/*.ts'],
    rules: {
      // 数据访问层需要按列名动态拼装 SQL，字段名全部来自内部常量表
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
