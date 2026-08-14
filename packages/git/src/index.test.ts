import { describe, expect, it } from "vitest";
import { resolveRepositoryPath } from "./index";

describe("repository paths", () => {
  it("allows an owned bare repository", () => {
    expect(resolveRepositoryPath("/srv/origin", "team/app.git")).toBe("/srv/origin/team/app.git");
  });

  it("rejects traversal", () => {
    expect(() => resolveRepositoryPath("/srv/origin", "../../etc")).toThrow();
  });
});
