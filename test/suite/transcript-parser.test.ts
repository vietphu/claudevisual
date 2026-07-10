import { strict as assert } from "assert";
import { parseTranscriptLine } from "../../src/core/transcript-parser";

describe("transcript-parser", () => {
  describe("parseTranscriptLine", () => {
    it("should parse a valid assistant line with usage", () => {
      const line = JSON.stringify({
        type: "assistant",
        sessionId: "test-session-1",
        cwd: "/Users/test/project",
        message: {
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined, "Should parse valid JSON");
      assert.equal(result.type, "assistant");
      assert.equal(result.sessionId, "test-session-1");
      assert.equal(result.cwd, "/Users/test/project");
      assert(result.raw.type === "assistant");
    });

    it("should parse a valid user line", () => {
      const line = JSON.stringify({
        type: "user",
        sessionId: "test-session-1",
        cwd: "/Users/test/project",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "task-123",
            },
          ],
        },
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined, "Should parse valid user line");
      assert.equal(result.type, "user");
      assert.equal(result.sessionId, "test-session-1");
    });

    it("should parse a mode line", () => {
      const line = JSON.stringify({
        type: "mode",
        mode: "acceptEdits",
        sessionId: "test-session-1",
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined, "Should parse mode line");
      assert.equal(result.type, "mode");
    });

    it("should handle unknown line types without throwing", () => {
      const line = JSON.stringify({
        type: "unknown-future-type",
        sessionId: "test-session-1",
        someNewField: "value",
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined, "Should parse unknown type");
      assert.equal(result.type, "unknown-future-type");
    });

    it("should return undefined for malformed JSON", () => {
      const line = "{ invalid json }";
      const result = parseTranscriptLine(line);
      assert.equal(result, undefined, "Should return undefined for unparsable JSON");
    });

    it("should handle missing type as 'unknown'", () => {
      const line = JSON.stringify({
        sessionId: "test-session-1",
        cwd: "/Users/test/project",
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.type, "unknown");
    });

    it("should handle non-string type as 'unknown'", () => {
      const line = JSON.stringify({
        type: 123,
        sessionId: "test-session-1",
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.type, "unknown");
    });

    it("should extract sessionId and cwd from root level", () => {
      const line = JSON.stringify({
        type: "assistant",
        sessionId: "abc-123",
        cwd: "/path/to/cwd",
        message: {},
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.sessionId, "abc-123");
      assert.equal(result.cwd, "/path/to/cwd");
    });

    it("should handle missing sessionId and cwd gracefully", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        },
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.sessionId, undefined);
      assert.equal(result.cwd, undefined);
    });

    it("should preserve the raw object", () => {
      const raw = {
        type: "assistant",
        sessionId: "test",
        message: {
          usage: {
            input_tokens: 100,
          },
        },
        customField: "custom-value",
      };
      const line = JSON.stringify(raw);

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.raw.customField, "custom-value");
    });

    it("should handle attachment line type", () => {
      const line = JSON.stringify({
        type: "attachment",
        sessionId: "test-session-1",
        attachment: {
          type: "hook_success",
          hookName: "SessionStart",
        },
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.type, "attachment");
    });

    it("should handle mode line with complex mode value", () => {
      const line = JSON.stringify({
        type: "mode",
        mode: "bypassPermissions",
        sessionId: "test",
      });

      const result = parseTranscriptLine(line);
      assert(result !== undefined);
      assert.equal(result.type, "mode");
    });
  });
});
