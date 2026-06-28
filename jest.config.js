/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // The Fake source seams (seed dataset, write store, fake-GitHub, source selection)
  // are unit-tested here. Your Gantt's own tests can live under lib/ too.
  testMatch: ["<rootDir>/lib/**/*.test.ts"],
  moduleNameMapper: {
    // Mirror tsconfig's "@/*" path alias so lib/ modules and their tests resolve it.
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
};
