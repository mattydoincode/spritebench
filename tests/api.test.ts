import { describe, expect, it } from "vitest";
import { absoluteUrl, requestOwner, requestPartUrl, sourceUrl } from "@/client/api";

describe("absoluteUrl", () => {
  it("resolves a relative api path against the page origin", () => {
    const path = sourceUrl("proj", "asset", "source");
    expect(path.startsWith("/api/")).toBe(true);
    expect(absoluteUrl(path, "http://127.0.0.1:4300")).toBe(
      "http://127.0.0.1:4300/api/projects/proj/assets/asset/source"
    );
  });
});

describe("requestPartUrl", () => {
  it("points at the finished asset when one exists", () => {
    expect(requestOwner("asset-1", "job-1")).toEqual({ assetId: "asset-1" });
    expect(requestPartUrl("proj", { assetId: "asset-1" }, "guide")).toBe(
      "/api/projects/proj/assets/asset-1/request?part=guide"
    );
  });

  it("falls back to the queued job so attachments can render before an asset exists", () => {
    expect(requestOwner(null, "job-1")).toEqual({ jobId: "job-1" });
    expect(requestPartUrl("proj", { jobId: "job-1" }, "reference")).toBe(
      "/api/projects/proj/jobs/job-1/request?part=reference"
    );
  });
});
