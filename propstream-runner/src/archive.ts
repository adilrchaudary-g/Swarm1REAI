import path from "node:path";
import { ensureDir, writeJsonFile } from "./utils/fs.js";

export type HarvestQuery = {
  zip: string;
  listName: string;
  maxResults?: number;
  maxSkipTraces?: number;
  filters?: Record<string, unknown>;
};

export type HarvestRunManifest = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  query: HarvestQuery;
  counts: {
    discovered: number;
    saved: number;
    exported: number;
    skipTraced: number;
    archivedProperties: number;
    archivedContacts: number;
  };
  artifacts: {
    rawExports: string[];
    pages: string[];
  };
};

export type ArchivedPropertyRecord = Record<string, unknown> & {
  property_id: string;
  address_state?: string;
  address_zip?: string;
};

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class ArchiveStore {
  readonly archiveRoot: string;

  constructor(archiveRoot: string) {
    this.archiveRoot = archiveRoot;
  }

  async startRun(query: HarvestQuery) {
    const startedAt = new Date().toISOString();
    const runId = `${startedAt.replace(/[:.]/g, "-")}-${slugify(query.listName || query.zip)}`;
    const runDir = path.join(this.archiveRoot, "runs", runId);
    const manifest: HarvestRunManifest = {
      runId,
      startedAt,
      query,
      counts: {
        discovered: 0,
        saved: 0,
        exported: 0,
        skipTraced: 0,
        archivedProperties: 0,
        archivedContacts: 0,
      },
      artifacts: {
        rawExports: [],
        pages: [],
      },
    };

    await ensureDir(path.join(runDir, "query"));
    await ensureDir(path.join(runDir, "raw-exports"));
    await ensureDir(path.join(runDir, "pages"));
    await ensureDir(path.join(runDir, "indexes"));
    await ensureDir(path.join(this.archiveRoot, "properties"));
    await ensureDir(path.join(this.archiveRoot, "indexes", "by-state"));
    await ensureDir(path.join(this.archiveRoot, "indexes", "by-zip"));
    await ensureDir(path.join(this.archiveRoot, "indexes", "by-list"));
    await writeJsonFile(path.join(runDir, "manifest.json"), manifest);
    await writeJsonFile(path.join(runDir, "query", "query.json"), query);

    return { runId, runDir, manifest };
  }

  async updateManifest(runDir: string, manifest: HarvestRunManifest) {
    await writeJsonFile(path.join(runDir, "manifest.json"), manifest);
  }

  async archiveSearchPage(runDir: string, pageNumber: number, items: Array<Record<string, unknown>>) {
    const pageFile = path.join(runDir, "pages", `page-${String(pageNumber).padStart(4, "0")}.json`);
    await writeJsonFile(pageFile, items);
    return pageFile;
  }

  async archiveExportRows(
    runDir: string,
    listName: string,
    rows: ArchivedPropertyRecord[],
  ) {
    const slug = slugify(listName);
    const exportFile = path.join(runDir, "raw-exports", `${slug || "export"}.json`);
    await writeJsonFile(exportFile, rows);
    return exportFile;
  }

  async archivePropertyRecords(listName: string, rows: ArchivedPropertyRecord[]) {
    const listSlug = slugify(listName);
    let propertyCount = 0;
    let contactCount = 0;

    for (const row of rows) {
      const propertyId = slugify(row.property_id) || "unknown-property";
      const state = slugify(String(row.address_state || "unknown"));
      const zip = slugify(String(row.address_zip || "unknown"));
      const propertyDir = path.join(this.archiveRoot, "properties", state, zip, propertyId);
      await ensureDir(propertyDir);
      await writeJsonFile(path.join(propertyDir, "property.json"), row);

      const phoneNumbers = Array.isArray(row.phone_numbers) ? row.phone_numbers : [];
      const emailAddresses = Array.isArray(row.email_addresses) ? row.email_addresses : [];
      if (phoneNumbers.length || emailAddresses.length) {
        contactCount += 1;
        await writeJsonFile(path.join(propertyDir, "contacts.json"), {
          property_id: row.property_id,
          phone_numbers: phoneNumbers,
          email_addresses: emailAddresses,
          contacts_returned: row.contacts_returned || phoneNumbers.length + emailAddresses.length,
        });
      }

      await this.appendIndex(path.join(this.archiveRoot, "indexes", "by-state", `${state}.ndjson`), {
        property_id: row.property_id,
        state: row.address_state,
        zip: row.address_zip,
        list_name: listName,
        path: propertyDir,
      });
      await this.appendIndex(path.join(this.archiveRoot, "indexes", "by-zip", `${zip}.ndjson`), {
        property_id: row.property_id,
        state: row.address_state,
        zip: row.address_zip,
        list_name: listName,
        path: propertyDir,
      });
      await this.appendIndex(path.join(this.archiveRoot, "indexes", "by-list", `${listSlug}.ndjson`), {
        property_id: row.property_id,
        state: row.address_state,
        zip: row.address_zip,
        list_name: listName,
        path: propertyDir,
      });
      propertyCount += 1;
    }

    return { propertyCount, contactCount };
  }

  private async appendIndex(filePath: string, row: Record<string, unknown>) {
    await ensureDir(path.dirname(filePath));
    const fs = await import("node:fs/promises");
    await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
  }
}
