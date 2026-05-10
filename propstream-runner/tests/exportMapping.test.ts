import { describe, expect, it } from "vitest";
import { mapExportRows } from "../src/exportMapping.js";

describe("export mapping", () => {
  it("maps exported contact and property fields", () => {
    const [row] = mapExportRows([
      {
        Address: "123 Main St",
        City: "Houston",
        State: "TX",
        Zip: "77084",
        APN: "123-ABC",
        "Property Type": "Single Family Residential",
        Bedrooms: "3",
        "Total Bathrooms": "2",
        "Building Sqft": "1450",
        "Lot Size Sqft": "5400",
        "Effective Year Built": "1988",
        "Total Assessed Value": "250000",
        "Last Sale Recording Date": "2020-01-01",
        "Last Sale Amount": "200000",
        "Owner 1 First Name": "Jane",
        "Owner 1 Last Name": "Doe",
        "Mailing Address": "PO Box 1",
        "Mailing City": "Houston",
        "Mailing State": "TX",
        "Mailing Zip": "77001",
        "Owner Occupied": "No",
        "Do Not Mail": "Yes",
        "Phone 1": "(555) 111-2222",
        "Phone 1 Type": "Mobile",
        "Phone 1 DNC": "No",
        "Email 1": "jane@example.com",
        Litigator: "No",
        "MLS Status": "EXPIRED",
        "Est. Value": "300000",
        "Est. Equity": "100000",
        "Est. Loan-to-Value": "66",
        "Foreclosure Factor": "Medium",
        "Skip Traces": "1",
      },
    ]);

    expect(row.property_type).toBe("single_family_residence_detached");
    expect(row.phone_numbers).toHaveLength(1);
    expect(row.distress_signals).toContain("mls_expired");
  });
});
