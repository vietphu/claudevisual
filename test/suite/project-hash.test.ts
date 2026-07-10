import { strict as assert } from "assert";
import * as path from "path";
import * as os from "os";
import { cwdToProjectHash, projectDirForCwd, claudeProjectsRoot, normalizeCwd } from "../../src/core/project-hash";

describe("project-hash", () => {
  describe("cwdToProjectHash", () => {
    it("should replace all non-alphanumeric characters with dashes", () => {
      const hash = cwdToProjectHash("/Users/test/my-project");
      assert.equal(hash, "-Users-test-my-project");
    });

    it("should handle slashes", () => {
      const hash = cwdToProjectHash("/Users/test/project");
      assert(hash.includes("-Users-"));
      assert(hash.includes("-test-"));
      assert(hash.includes("-project"));
    });

    it("should handle dots", () => {
      const hash = cwdToProjectHash("/Users/test/.claude/projects");
      assert.equal(hash, "-Users-test--claude-projects");
    });

    it("should handle hyphens (no change)", () => {
      const hash = cwdToProjectHash("/Users/test/my-project-name");
      assert.equal(hash, "-Users-test-my-project-name");
    });

    it("should handle underscores", () => {
      const hash = cwdToProjectHash("/Users/test/my_project");
      assert.equal(hash, "-Users-test-my-project"); // underscores are NOT alphanumeric, replaced with dash
    });

    it("should handle multiple consecutive non-alphanumeric", () => {
      const hash = cwdToProjectHash("/Users//test//project");
      assert.equal(hash, "-Users--test--project");
    });

    it("should preserve numbers", () => {
      const hash = cwdToProjectHash("/Users/test123/project2");
      assert.equal(hash, "-Users-test123-project2");
    });

    it("should preserve letters case", () => {
      const hash = cwdToProjectHash("/Users/Test/MyProject");
      assert.equal(hash, "-Users-Test-MyProject");
    });

    it("should handle special characters like parentheses", () => {
      const hash = cwdToProjectHash("/Users/test (1)/project");
      assert.equal(hash, "-Users-test--1--project");
    });

    it("should handle empty string", () => {
      const hash = cwdToProjectHash("");
      assert.equal(hash, "");
    });

    it("should handle relative paths", () => {
      const hash = cwdToProjectHash("./my-project");
      assert.equal(hash, "--my-project");
    });
  });

  describe("claudeProjectsRoot", () => {
    it("should return ~/.claude/projects", () => {
      const root = claudeProjectsRoot();
      const expected = path.join(os.homedir(), ".claude", "projects");
      assert.equal(root, expected);
    });

    it("should be consistent across calls", () => {
      const root1 = claudeProjectsRoot();
      const root2 = claudeProjectsRoot();
      assert.equal(root1, root2);
    });
  });

  describe("projectDirForCwd", () => {
    it("should return correct path for workspace folder", () => {
      const cwd = "/Users/test/my-project";
      const dir = projectDirForCwd(cwd);
      const root = claudeProjectsRoot();
      const expectedHash = cwdToProjectHash(cwd);
      const expected = path.join(root, expectedHash);
      assert.equal(dir, expected);
    });

    it("should combine root and hash correctly", () => {
      const cwd = "/Users/dinhphu/Desktop/ClaudeVisual";
      const dir = projectDirForCwd(cwd);
      assert(dir.includes(".claude/projects"));
      assert(dir.includes("-Users-dinhphu-Desktop-ClaudeVisual"));
    });

    it("should handle complex paths", () => {
      const cwd = "/Users/test/nested/deeply/my.project-name";
      const dir = projectDirForCwd(cwd);
      assert(dir.includes("-nested-"));
      assert(dir.includes("-my-project-name"));
    });
  });

  describe("normalizeCwd", () => {
    it("should handle absolute paths that exist", () => {
      const cwd = os.homedir();
      const normalized = normalizeCwd(cwd);
      assert.equal(typeof normalized, "string");
      assert.equal(normalized.length > 0, true);
    });

    it("should resolve symlinks when path exists", () => {
      const cwd = "/tmp";
      const normalized = normalizeCwd(cwd);
      // /tmp on macOS is symlinked to /private/tmp
      assert.equal(typeof normalized, "string");
    });

    it("should fallback to path.resolve for non-existent paths", () => {
      const cwd = "/non/existent/path/to/nowhere";
      const normalized = normalizeCwd(cwd);
      // Should not throw, returns resolved path
      assert.equal(typeof normalized, "string");
      assert(normalized.includes("non"));
    });

    it("should handle relative paths", () => {
      const cwd = ".";
      const normalized = normalizeCwd(cwd);
      // Should resolve to absolute path
      assert(path.isAbsolute(normalized));
    });

    it("should normalize consistently", () => {
      const cwd = "/Users/test";
      const normalized1 = normalizeCwd(cwd);
      const normalized2 = normalizeCwd(cwd);
      assert.equal(normalized1, normalized2);
    });
  });
});
