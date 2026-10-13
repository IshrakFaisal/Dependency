/** Expected failures whose messages are safe to display in the analysis UI. */
export class AnalysisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisInputError";
  }
}
