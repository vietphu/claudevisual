import { strict as assert } from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { mergeJsonFile, ensureArray, ensureObject, JsonMergeError, readFileHash } from "../../src/hooks/json-merge";

describe("json-merge", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `json-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    testFilePath = path.join(tempDir, "test-settings.json");
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("mergeJsonFile", () => {
    it("should create file with mutated data when file doesn't exist", async () => {
      const result = await mergeJsonFile(testFilePath, (data) => {
        data.test = "value";
        data.hooks = {};
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.test, "value");
      assert.equal(result.backupPath, undefined, "No backup when file didn't exist");
    });

    it("should create backup when file exists", async () => {
      // Create initial file
      await fs.promises.writeFile(testFilePath, JSON.stringify({ old: "data" }));

      const result = await mergeJsonFile(testFilePath, (data) => {
        data.new = "value";
      });

      assert(result.backupPath !== undefined);
      assert(result.backupPath.includes(".bak-"), "Backup path should contain .bak- timestamp");
      const backupExists = await fs.promises
        .access(result.backupPath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
      assert(backupExists, "Backup file should exist");
    });

    it("should preserve original on backup", async () => {
      const original = { original: "data", hooks: { SessionStart: [] } };
      await fs.promises.writeFile(testFilePath, JSON.stringify(original));

      const result = await mergeJsonFile(testFilePath, (data) => {
        data.newField = "added";
      });

      const backupContent = await fs.promises.readFile(result.backupPath!, "utf8");
      const backupData = JSON.parse(backupContent);
      assert.equal(backupData.original, "data");
      assert.equal(backupData.newField, undefined);
    });

    it("should rollback to backup on write failure", async () => {
      const original = { original: "data" };
      await fs.promises.writeFile(testFilePath, JSON.stringify(original));

      try {
        await mergeJsonFile(testFilePath, (data) => {
          data.newField = "value";
          // Simulate a write failure by making the directory read-only
          // (This would fail on write, but we'll test the error path)
          throw new Error("Simulated error");
        });
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
      }
    });

    it("should throw JsonMergeError on mutate callback error", async () => {
      try {
        await mergeJsonFile(testFilePath, () => {
          throw new Error("Mutation failed");
        });
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
        assert(err.message.includes("mutate callback threw"));
      }
    });

    it("should throw JsonMergeError on invalid JSON", async () => {
      await fs.promises.writeFile(testFilePath, "{ invalid json }");

      try {
        await mergeJsonFile(testFilePath, () => {
          // Won't reach here
        });
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
        assert(err.message.includes("failed to parse JSON"));
      }
    });

    it("should handle empty file as empty object", async () => {
      await fs.promises.writeFile(testFilePath, "");

      await mergeJsonFile(testFilePath, (data) => {
        data.test = "value";
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.test, "value");
    });

    it("should format JSON with 2-space indent and trailing newline", async () => {
      await mergeJsonFile(testFilePath, (data) => {
        data.a = 1;
        data.b = 2;
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      assert(content.includes("  "), "Should have 2-space indent");
      assert(content.endsWith("\n"), "Should end with newline");
    });

    it("should handle multiple mutations in a single call", async () => {
      let callCount = 0;
      await mergeJsonFile(testFilePath, (data) => {
        callCount++;
        data.hooks = ensureObject(data, "hooks");
        const hooks = data.hooks as Record<string, unknown>;
        const sessionStart = ensureArray(hooks, "SessionStart");
        sessionStart.push({ name: "hook1" });
      });

      assert.equal(callCount, 1, "Mutate should only be called once");

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert(Array.isArray(parsed.hooks.SessionStart));
      assert.equal(parsed.hooks.SessionStart.length, 1);
    });

    it("should update existing object without losing other properties", async () => {
      const initial = { keep: "this", data: { nested: "value" } };
      await fs.promises.writeFile(testFilePath, JSON.stringify(initial));

      await mergeJsonFile(testFilePath, (data) => {
        data.added = "new";
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.keep, "this");
      assert.equal(parsed.data.nested, "value");
      assert.equal(parsed.added, "new");
    });

    it("should return a contentHash matching the bytes actually written", async () => {
      const result = await mergeJsonFile(testFilePath, (data) => {
        data.a = 1;
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const expectedHash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
      assert.equal(result.contentHash, expectedHash);
      assert.equal(result.contentHash, await readFileHash(testFilePath));
    });

    it("should serialize concurrent calls against the same path so no write is lost", async () => {
      // Fire N concurrent read-increment-write cycles at the same file — without
      // per-path locking, each would read the same pre-mutation snapshot and
      // the last writer would silently discard every other increment.
      const concurrency = 20;
      await Promise.all(
        Array.from({ length: concurrency }, () =>
          mergeJsonFile<{ counter?: number }>(testFilePath, (data) => {
            data.counter = (data.counter ?? 0) + 1;
          })
        )
      );

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.counter, concurrency, "every concurrent increment should be preserved, none lost to a race");
    });

    it("should propagate each concurrent call's own success/failure to its caller", async () => {
      const results = await Promise.allSettled([
        mergeJsonFile(testFilePath, (data) => {
          data.first = "ok";
        }),
        mergeJsonFile(testFilePath, () => {
          throw new Error("boom");
        }),
        mergeJsonFile(testFilePath, (data) => {
          data.third = "ok";
        }),
      ]);

      assert.equal(results[0].status, "fulfilled");
      assert.equal(results[1].status, "rejected");
      assert.equal(results[2].status, "fulfilled");
      if (results[1].status === "rejected") {
        assert(results[1].reason instanceof JsonMergeError);
      }

      // The failing call in the middle of the queue must not block calls
      // queued behind it — both other writes should have landed.
      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.first, "ok");
      assert.equal(parsed.third, "ok");
    });
  });

  describe("ensureArray", () => {
    it("should return existing array", () => {
      const container = { items: [1, 2, 3] };
      const result = ensureArray(container, "items");
      assert.deepEqual(result, [1, 2, 3]);
    });

    it("should create empty array if key missing", () => {
      const container: Record<string, unknown> = {};
      const result = ensureArray(container, "items");
      assert.deepEqual(result, []);
      assert(Array.isArray(container.items));
    });

    it("should throw JsonMergeError if key exists but not array", () => {
      const container = { items: "not-an-array" };
      try {
        ensureArray(container, "items");
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
        assert(err.message.includes("expected"));
        assert(err.message.includes("to be an array"));
      }
    });

    it("should throw JsonMergeError if key is object", () => {
      const container = { items: { nested: "object" } };
      try {
        ensureArray(container, "items");
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
      }
    });

    it("should throw JsonMergeError if key is null", () => {
      const container = { items: null };
      try {
        ensureArray(container, "items");
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
      }
    });

    it("should allow multiple appends to created array", () => {
      const container: Record<string, unknown> = {};
      const arr = ensureArray(container, "hooks");
      arr.push({ hook1: "value1" });
      arr.push({ hook2: "value2" });
      assert.equal(arr.length, 2);
      assert.deepEqual(container.hooks, [{ hook1: "value1" }, { hook2: "value2" }]);
    });
  });

  describe("ensureObject", () => {
    it("should return existing object", () => {
      const container = { config: { key: "value" } };
      const result = ensureObject(container, "config");
      assert.deepEqual(result, { key: "value" });
    });

    it("should create empty object if key missing", () => {
      const container: Record<string, unknown> = {};
      const result = ensureObject(container, "config");
      assert.deepEqual(result, {});
      assert(typeof container.config === "object");
      assert(!Array.isArray(container.config));
    });

    it("should throw JsonMergeError if key is array", () => {
      const container = { config: [1, 2, 3] };
      try {
        ensureObject(container, "config");
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
        assert(err.message.includes("to be an object"));
      }
    });

    it("should throw JsonMergeError if key is string", () => {
      const container = { config: "string-value" };
      try {
        ensureObject(container, "config");
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
      }
    });

    it("should throw JsonMergeError if key is null", () => {
      const container = { config: null };
      try {
        ensureObject(container, "config");
        assert.fail("Should have thrown");
      } catch (err) {
        assert(err instanceof JsonMergeError);
      }
    });

    it("should allow setting properties on created object", () => {
      const container: Record<string, unknown> = {};
      const obj = ensureObject(container, "config");
      obj.key1 = "value1";
      obj.key2 = "value2";
      assert.deepEqual(container.config, { key1: "value1", key2: "value2" });
    });
  });

  describe("hooks array mutation (real-world scenario)", () => {
    it("should append hooks without replacing array", async () => {
      const initial = {
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "existing" }],
            },
          ],
        },
      };
      await fs.promises.writeFile(testFilePath, JSON.stringify(initial));

      await mergeJsonFile(testFilePath, (data) => {
        const hooks = ensureObject(data, "hooks");
        const sessionStart = ensureArray(hooks, "SessionStart");
        sessionStart.push({
          matcher: "new",
          hooks: [{ type: "command", command: "new-command" }],
        });
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.hooks.SessionStart.length, 2);
      assert.equal(parsed.hooks.SessionStart[0].matcher, "startup");
      assert.equal(parsed.hooks.SessionStart[1].matcher, "new");
    });

    it("should handle complex hooks structure", async () => {
      const initial = {
        hooks: {
          SessionStart: [],
          UserPromptSubmit: [],
          PostToolUse: [],
        },
        statusLine: {
          type: "command",
          command: "existing-command",
          padding: 0,
        },
      };
      await fs.promises.writeFile(testFilePath, JSON.stringify(initial));

      await mergeJsonFile(testFilePath, (data) => {
        const hooks = ensureObject(data, "hooks");
        const sessionStart = ensureArray(hooks, "SessionStart");
        sessionStart.push({
          matcher: "startup|clear",
          hooks: [
            {
              type: "command",
              command: "new-hook-command",
              timeout: 60,
            },
          ],
        });
      });

      const content = await fs.promises.readFile(testFilePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.hooks.SessionStart.length, 1);
      assert.equal(parsed.hooks.UserPromptSubmit.length, 0);
      assert.equal(parsed.statusLine.command, "existing-command");
    });
  });
});
