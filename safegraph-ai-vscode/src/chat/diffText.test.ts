import { extractDiffBlocks, formatApplyError, shellQuote, stripDiffBlocksForLiveApply } from "./diffText";

describe("diffText", () => {
  it("extracts fenced diff blocks", () => {
    const text = [
      "before",
      "```diff",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@",
      "-old",
      "+new",
      "```",
      "after"
    ].join("\n");

    expect(extractDiffBlocks(text)).toEqual([
      ["--- a/file.txt", "+++ b/file.txt", "@@", "-old", "+new"].join("\n")
    ]);
  });

  it("removes diff blocks from live assistant text", () => {
    expect(stripDiffBlocksForLiveApply("summary\n\n```diff\n+change\n```\n\nnext")).toBe("summary\n\nnext");
  });

  it("formats common apply failures with recovery guidance", () => {
    expect(formatApplyError(new Error("Context mismatch while applying diff."))).toContain(
      "target file changed"
    );
  });

  it("quotes shell arguments with single quotes", () => {
    expect(shellQuote("src/it's.py")).toBe("'src/it'\\''s.py'");
  });
});
