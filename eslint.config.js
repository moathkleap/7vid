import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/** Custom rule: forbid empty click handlers so no button can be a dead button. */
const noEmptyHandlers = {
  meta: { type: 'problem', docs: { description: 'disallow empty event handlers (dead buttons)' }, schema: [] },
  create(context) {
    return {
      JSXAttribute(node) {
        if (!node.name || !/^on[A-Z]/.test(node.name.name ?? '')) return;
        const v = node.value;
        if (!v || v.type !== 'JSXExpressionContainer') return;
        const fn = v.expression;
        if ((fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') && fn.body.type === 'BlockStatement' && fn.body.body.length === 0) {
          context.report({ node, message: 'Empty event handler: every control must do something real or be gated with an explanation.' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.sevenvid-dev/**', 'ai-worker/**', 'tests/fixtures/generated/**', '**/*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks, sevenvid: { rules: { 'no-empty-handlers': noEmptyHandlers } } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'sevenvid/no-empty-handlers': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
    },
  },
);
