import { describe, expect, it } from "vitest";
import { assertSlug, repositoryStorageKey, slugify } from "./index";

describe("repository identity", () => {
  it("normalizes human names into stable slugs", () => {
    expect(slugify("  Human + Agent Team ")).toBe("human-agent-team");
  });

  it("prevents traversal in storage keys", () => {
    expect(() => repositoryStorageKey("../root", "project")).toThrow();
    expect(assertSlug("origin-dev")).toBe("origin-dev");
  });
});
