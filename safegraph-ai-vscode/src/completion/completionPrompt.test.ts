import {
  buildCompletionPrompt,
  buildCompletionSystemPrompt,
  cleanCompletion,
  COMPLETION_STOP_SEQUENCES
} from "./completionPrompt";

describe("buildCompletionSystemPrompt", () => {
  it("is concise, forbids prose, and asks for the end sentinel", () => {
    const sys = buildCompletionSystemPrompt();
    expect(sys).toMatch(/Output ONLY the raw code/);
    expect(sys).toMatch(/<\|END\|>/);
    expect(sys).toMatch(/Do not add explanations/);
  });
});

describe("buildCompletionPrompt", () => {
  it("places a <CURSOR> marker between prefix and suffix", () => {
    const prompt = buildCompletionPrompt({
      language: "typescript",
      prefix: "const a = 1;\nconst b = ",
      suffix: ";\nconsole.log(b);",
      currentLine: "const b = "
    });
    expect(prompt).toContain("Language: typescript");
    expect(prompt).toContain("const b = <CURSOR>;");
  });

  it("truncates very long prefix/suffix to the side budget keeping the cursor edges", () => {
    const prefix = "P".repeat(10000) + "EDGE_PREFIX";
    const suffix = "EDGE_SUFFIX" + "S".repeat(10000);
    const prompt = buildCompletionPrompt(
      { language: "python", prefix, suffix, currentLine: "" },
      { maxSideChars: 100 }
    );
    expect(prompt).toContain("EDGE_PREFIX<CURSOR>EDGE_SUFFIX");
    // Only 100 chars kept on each side, so the full 10k runs are dropped.
    expect(prompt).not.toContain("P".repeat(200));
    expect(prompt).not.toContain("S".repeat(200));
  });

  it("includes imports and respects single-line mode", () => {
    const prompt = buildCompletionPrompt(
      {
        language: "javascript",
        prefix: "x",
        suffix: "",
        currentLine: "x",
        imports: ["react", "lodash"]
      },
      { multiline: false }
    );
    expect(prompt).toContain("Imports: react, lodash");
    expect(prompt).toContain("Complete only the current line.");
  });
});

describe("cleanCompletion", () => {
  it("strips the end sentinel and trailing content", () => {
    expect(cleanCompletion("foo()<|END|> ignored after")).toBe("foo()");
  });

  it("removes surrounding markdown code fences", () => {
    expect(cleanCompletion("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("drops a leading echo of the already-typed line", () => {
    expect(cleanCompletion("const b = 2;", "const b = ")).toBe("2;");
  });

  it("collapses to a single line when multiline is false", () => {
    expect(cleanCompletion("first\nsecond", "", false)).toBe("first");
  });

  it("returns empty string for empty model output", () => {
    expect(cleanCompletion("")).toBe("");
  });
});

describe("COMPLETION_STOP_SEQUENCES", () => {
  it("stays within the Bedrock limit of 4 stop sequences", () => {
    expect(COMPLETION_STOP_SEQUENCES.length).toBeLessThanOrEqual(4);
    expect(COMPLETION_STOP_SEQUENCES).toContain("<|END|>");
  });
});
