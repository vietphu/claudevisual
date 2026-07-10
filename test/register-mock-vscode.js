/**
 * Register hook to mock the vscode module for unit tests.
 * Must be loaded before ts-node processes any TypeScript files.
 */

const Module = require("module");
const path = require("path");

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain) {
  if (request === "vscode") {
    // Return path to our mock vscode module
    return path.join(__dirname, "vscode.js");
  }
  return originalResolveFilename.call(this, request, parent, isMain);
};
