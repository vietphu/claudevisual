/**
 * Mock vscode module for unit tests.
 * This module is placed in the test directory to intercept vscode imports.
 */

module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => {
        // No-op for tests
      },
      dispose: () => {
        // No-op
      },
    }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, defaultValue) => defaultValue,
    }),
    onDidChangeConfiguration: () => ({
      dispose: () => {
        // No-op
      },
    }),
  },
  ExtensionContext: class {},
};
