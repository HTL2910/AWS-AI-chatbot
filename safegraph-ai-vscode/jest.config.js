/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.d.ts"],
  coverageDirectory: "coverage",
  moduleNameMapper: {
    "^vscode$": "<rootDir>/src/__mocks__/vscode.js"
  },
  moduleFileExtensions: ["ts", "js", "json"]
};
