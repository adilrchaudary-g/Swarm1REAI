import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArchiveStore } from "../src/archive.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("archive store", () => {
  it("writes navigable property and index structure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ps-archive-"));
    tempDirs.push(root);
    const archiveRoot = path.join(root, "archive");
    const store = new ArchiveStore(archiveRoot);
    const run = await store.startRun({
      zip: "77084",
      listName: "Houston - Vacant Absentee",
      maxSkipTraces: 2,
    });

    const archived = await store.archivePropertyRecords("Houston - Vacant Absentee", [
      {
        property_id: "prop-1",
        address_state: "TX",
        address_zip: "77084",
        phone_numbers: [{ value: "5551112222", type: "Mobile", dnc: false }],
        email_addresses: ["jane@example.com"],
        contacts_returned: 2,
      },
    ]);

    expect(archived.propertyCount).toBe(1);
    expect(archived.contactCount).toBe(1);

    const propertyFile = path.join(
      archiveRoot,
      "properties",
      "tx",
      "77084",
      "prop-1",
      "property.json",
    );
    const indexFile = path.join(
      archiveRoot,
      "indexes",
      "by-list",
      "houston-vacant-absentee.ndjson",
    );

    const property = JSON.parse(await readFile(propertyFile, "utf8"));
    const index = await readFile(indexFile, "utf8");
    expect(property.property_id).toBe("prop-1");
    expect(index).toContain("prop-1");
    expect(run.runId).toBeTruthy();
  });
});
