function csvValue(row: Record<string, string>, key: string): string {
  return String(row[key] || "").trim();
}

function csvNumber(row: Record<string, string>, key: string): number | null {
  const value = csvValue(row, key).replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvBooleanYesNo(row: Record<string, string>, key: string): boolean | null {
  const value = csvValue(row, key).toLowerCase();
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function normalizePropertyType(value: string): string {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("single family")) return "single_family_residence_detached";
  return normalized.replace(/\s+/g, "_") || "";
}

function composeOwnerName(row: Record<string, string>) {
  const owner1 = [csvValue(row, "Owner 1 First Name"), csvValue(row, "Owner 1 Last Name")]
    .filter(Boolean)
    .join(" ");
  const owner2 = [csvValue(row, "Owner 2 First Name"), csvValue(row, "Owner 2 Last Name")]
    .filter(Boolean)
    .join(" ");
  return [owner1, owner2].filter(Boolean).join(" & ");
}

function composeMailingAddress(row: Record<string, string>) {
  return [
    csvValue(row, "Mailing Care of Name"),
    csvValue(row, "Mailing Address"),
    csvValue(row, "Mailing Unit #"),
    csvValue(row, "Mailing City"),
    csvValue(row, "Mailing State"),
    csvValue(row, "Mailing Zip"),
  ]
    .filter(Boolean)
    .join(", ");
}

function buildPhoneNumbers(row: Record<string, string>) {
  const phones: Array<{ value: string; type: string; dnc: boolean | null }> = [];
  for (let index = 1; index <= 5; index += 1) {
    const number = csvValue(row, `Phone ${index}`);
    if (!number) continue;
    phones.push({
      value: number,
      type: csvValue(row, `Phone ${index} Type`) || "unknown",
      dnc: csvBooleanYesNo(row, `Phone ${index} DNC`),
    });
  }
  return phones;
}

function buildEmailAddresses(row: Record<string, string>) {
  const emails: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const value = csvValue(row, `Email ${index}`);
    if (value) emails.push(value);
  }
  return emails;
}

function deriveDistressSignals(row: Record<string, string>) {
  const signals: string[] = [];
  const mlsStatus = csvValue(row, "MLS Status").toUpperCase();
  if (mlsStatus === "EXPIRED") signals.push("mls_expired");
  if (mlsStatus === "WITHDRAWN") signals.push("mls_withdrawn");
  return signals;
}

export function mapExportRows(rows: Array<Record<string, string>>) {
  return rows.map((row) => {
    const addressStreet = csvValue(row, "Address");
    const addressCity = csvValue(row, "City");
    const addressState = csvValue(row, "State");
    const addressZip = csvValue(row, "Zip");
    const phoneNumbers = buildPhoneNumbers(row);
    const emailAddresses = buildEmailAddresses(row);

    return {
      property_id:
        csvValue(row, "APN") ||
        [addressStreet, addressCity, addressState, addressZip].filter(Boolean).join("|"),
      lane: "houses",
      address_full: [addressStreet, addressCity, addressState, addressZip].filter(Boolean).join(", "),
      address_street: addressStreet,
      address_city: addressCity,
      address_state: addressState,
      address_zip: addressZip,
      parcel_number: csvValue(row, "APN"),
      property_type: normalizePropertyType(csvValue(row, "Property Type")),
      bedrooms: csvNumber(row, "Bedrooms"),
      bathrooms: csvNumber(row, "Total Bathrooms"),
      square_feet: csvNumber(row, "Building Sqft"),
      lot_size_sqft: csvNumber(row, "Lot Size Sqft"),
      year_built: csvNumber(row, "Effective Year Built"),
      current_tax_assessment: csvNumber(row, "Total Assessed Value"),
      last_sale_date: csvValue(row, "Last Sale Recording Date"),
      last_sale_price: csvNumber(row, "Last Sale Amount"),
      owner_name: composeOwnerName(row),
      owner_occupied: csvBooleanYesNo(row, "Owner Occupied"),
      owner_type: "",
      mailing_address: composeMailingAddress(row),
      do_not_mail: csvBooleanYesNo(row, "Do Not Mail"),
      phone_numbers: phoneNumbers,
      email_addresses: emailAddresses,
      contacts_returned: phoneNumbers.length + emailAddresses.length,
      litigator: csvBooleanYesNo(row, "Litigator"),
      mls_status: csvValue(row, "MLS Status"),
      distress_signals: deriveDistressSignals(row),
      propstream_arv_estimate: csvNumber(row, "Est. Value"),
      propstream_equity: csvNumber(row, "Est. Equity"),
      propstream_ltv: csvNumber(row, "Est. Loan-to-Value"),
      propstream_foreclosure_factor: csvValue(row, "Foreclosure Factor"),
      skip_trace_count: csvNumber(row, "Skip Traces"),
    };
  });
}
