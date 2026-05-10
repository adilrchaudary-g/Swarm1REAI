import { describe, expect, it } from "vitest";
import { PageStateSchema } from "../src/supervisor/schema.js";

describe("page state schema", () => {
  it("accepts a sanitized page snapshot", () => {
    const parsed = PageStateSchema.parse({
      route: "/search",
      title: "PropStream",
      page_phase: "search",
      visible_regions: ["main", "dialog: Filters"],
      candidate_actions: ["Filters", "Search"],
      result_count_text: "2 PROPERTIES",
      visible_row_count: 2,
      selected_list_name: null,
      selected_zip: "77084",
      has_captcha: false,
      auth_required: false,
      diagnostics: {
        row_preview: [{ propertyId: "prop-1" }],
      },
    });

    expect(parsed.visible_row_count).toBe(2);
  });
});
