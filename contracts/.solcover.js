module.exports = {
  skipFiles: ["mocks"],
  mocha: { grep: "deployed bytecode fits under", invert: true },
};
