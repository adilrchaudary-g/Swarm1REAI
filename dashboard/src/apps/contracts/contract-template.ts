import type { ContractData } from '../../api/types'

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

export function numberToWords(n: number): string {
  if (n === 0) return 'Zero'
  if (n < 0) return 'Negative ' + numberToWords(-n)

  let result = ''
  if (n >= 1_000_000) {
    result += numberToWords(Math.floor(n / 1_000_000)) + ' Million '
    n %= 1_000_000
  }
  if (n >= 1_000) {
    result += numberToWords(Math.floor(n / 1_000)) + ' Thousand '
    n %= 1_000
  }
  if (n >= 100) {
    result += ONES[Math.floor(n / 100)] + ' Hundred '
    n %= 100
  }
  if (n >= 20) {
    result += TENS[Math.floor(n / 10)] + ' '
    n %= 10
  }
  if (n > 0) {
    result += ONES[n] + ' '
  }
  return result.trim()
}

function u(val: string) {
  return val ? `<u>${val}</u>` : '<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>'
}

export function renderOptionAgreement(
  data: ContractData,
  purchaserSignature?: string,
  sellerSignature?: string,
): string {
  const day = data.contract_date_day || new Date().getDate().toString()
  const month = data.contract_date_month || new Date().toLocaleString('en', { month: 'long' })
  const year = data.contract_date_year || new Date().getFullYear().toString().slice(-2)

  const amountDue = data.purchase_price - data.option_fee

  const sigImg = (src?: string) =>
    src
      ? `<img src="${src}" style="height: 48px; margin-top: 4px;" />`
      : '<div style="height: 48px; border-bottom: 1px solid #333; margin-top: 4px;"></div>'

  return `
<div style="font-family: 'Times New Roman', Times, serif; font-size: 13.5px; color: #000; line-height: 1.55;
            max-width: 680px; margin: 0 auto; padding: 40px; background: #fff;">

  <p style="text-align: center; font-size: 11px; color: #666; margin-bottom: 4px;">OPTION AGREEMENT FOR PURCHASE OF REAL PROPERTY</p>

  <h1 style="text-align: center; font-size: 20px; margin-bottom: 24px; font-weight: bold;">
    OPTION AGREEMENT FOR PURCHASE OF REAL PROPERTY
  </h1>

  <p>
    THIS OPTION AGREEMENT FOR PURCHASE OF REAL PROPERTY (this &ldquo;Agreement&rdquo;) is made and
    entered into as of the ${u(day)} day of ${u(month)}, 20${u(year)}, by and between
    ${u(data.seller_name)}, whose mailing address is
    ${u(data.seller_address || '')} (&ldquo;Seller&rdquo;), and
    ${u(data.purchaser_name)}, whose mailing address is
    ${u(data.purchaser_address)} (&ldquo;Purchaser&rdquo;). Seller and Purchaser may be
    referred to individually as a &ldquo;Party&rdquo; and collectively as the &ldquo;Parties.&rdquo;
  </p>

  <h2 style="text-align: center; font-size: 16px; margin: 20px 0 12px; font-weight: bold;">RECITALS</h2>

  <p>
    A. Seller represents that Seller is the fee simple owner of the real property located in the County/City of
    ${u(data.property_county)}, State/Commonwealth of ${u(data.property_state)},
    commonly known as ${u(data.property_address)} (the &ldquo;Property&rdquo;).
  </p>

  <p>
    B. The Property is more particularly described by the legal description attached as Exhibit A, or, if no exhibit is
    attached, by the following legal description:<br/>
    <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>
  </p>

  <p>
    C. Purchaser desires to obtain from Seller the exclusive option to purchase the Property on the terms stated in
    this Agreement, and Seller desires to grant that option.
  </p>

  <p>
    NOW, THEREFORE, for good and valuable consideration, the receipt and sufficiency of which are
    acknowledged, the Parties agree as follows:
  </p>

  <p>
    <strong>1. GRANT OF OPTION.</strong> Seller hereby grants to Purchaser the exclusive and assignable right and option to
    purchase the Property (the &ldquo;Option&rdquo;) during the Option Term on the terms and conditions stated in this
    Agreement. During the Option Term, Seller shall not sell, contract to sell, lease, encumber, transfer, or
    otherwise dispose of the Property, except as expressly permitted by this Agreement or agreed to in writing by
    Purchaser.
  </p>

  <p>
    <strong>2. OPTION FEE.</strong> As consideration for the Option, Purchaser shall pay an option fee in the amount of
    $${u(data.option_fee.toLocaleString())} (the &ldquo;Option Fee&rdquo;) on or before the date this Agreement is fully executed. The Option Fee
    shall be paid to: [X] Seller directly; [ ] the escrow/title company identified in Section 11; or [ ] other:
    ______________________________. Unless this Agreement expressly states otherwise, the Option Fee is
    non-refundable to Purchaser if Purchaser does not exercise the Option before expiration of the Option Term. If
    Purchaser exercises the Option and closing occurs, the Option Fee shall be credited toward the Purchase
    Price at closing.
  </p>

  <p>
    <strong>3. OPTION TERM.</strong> The Option shall begin on the date this Agreement is fully executed by both Parties (the
    &ldquo;Execution Date&rdquo;) and shall expire at 5:00 p.m. local time for the Property on
    ${u(data.option_term_end_date)}, 20${u(year)} (the &ldquo;Option Expiration Date&rdquo;), unless extended in writing by both
    Parties. The period between the Execution Date and the Option Expiration Date is the &ldquo;Option Term.&rdquo; Time is of
    the essence for all deadlines in this Agreement.
  </p>

  <p>
    <strong>4. EXERCISE OF OPTION.</strong> Purchaser may exercise the Option at any time during the Option Term by
    delivering written notice to Seller before the Option expires (the &ldquo;Exercise Notice&rdquo;). The date Purchaser sends
    or delivers the Exercise Notice is the &ldquo;Option Exercise Date.&rdquo; Upon timely exercise of the Option, this
    Agreement shall automatically become a binding contract for Seller to sell and Purchaser, or Purchaser&rsquo;s
    assignee, to purchase the Property on the terms stated in this Agreement. The Parties shall execute customary
    closing documents required by the title company, settlement agent, lender, or applicable law, but no separate
    purchase agreement shall be required unless the Parties both agree in writing.
  </p>

  <p>
    <strong>5. PURCHASE PRICE.</strong> The purchase price for the Property shall be $${u(data.purchase_price.toLocaleString())} (the &ldquo;Purchase
    Price&rdquo;). At closing, Purchaser shall receive a credit against the Purchase Price for the Option Fee actually paid.
    The balance due at closing, before prorations, adjustments, closing costs, credits, and lender charges, shall be
    $${u(amountDue.toLocaleString())}.
  </p>

  <p>
    <strong>6. CLOSING.</strong> Closing shall occur on or before the earlier of (a) ______ days after the Option Exercise Date, or
    (b) ${u(data.closing_date)}, 20${u(year)}, unless the Parties agree in writing to a different closing date
    (the &ldquo;Closing Date&rdquo;). Closing shall occur through a licensed title company, settlement agent, escrow agent, or
    attorney selected by Purchaser, unless applicable law requires otherwise. Seller shall convey title by a deed
    customarily used in the jurisdiction where the Property is located, subject only to permitted exceptions
    approved by Purchaser.
  </p>

  <p>
    <strong>7. CLOSING COSTS AND PRORATIONS.</strong> Unless otherwise required by law or agreed in writing: (a)
    Purchaser shall pay Purchaser-side closing costs, lender charges, recording fees for Purchaser&rsquo;s documents,
    and title insurance premiums requested by Purchaser; (b) Seller shall pay Seller-side closing costs, costs to
    release liens or encumbrances, deed preparation charges customarily paid by sellers, and any transfer taxes
    or grantor taxes customarily paid by sellers in the Property&rsquo;s jurisdiction; and (c) real estate taxes, rents,
    homeowner association dues, utilities, and other property-related charges shall be prorated as of the Closing
    Date.
  </p>

  <p>
    <strong>8. TITLE.</strong> Seller shall convey good, marketable, and insurable title to the Property, free and clear of all liens,
    judgments, deeds of trust, mortgages, leases, occupancy rights, code violations, and encumbrances, except for
    matters accepted in writing by Purchaser. Purchaser may obtain a title search or title commitment. If title
    defects are discovered, Seller shall use commercially reasonable efforts to cure them before closing and may
    use closing proceeds to satisfy monetary liens. If Seller cannot deliver title as required, Purchaser may
    terminate this Agreement and receive a return of all amounts paid by Purchaser, without limiting any other
    remedies available for Seller default.
  </p>

  <p>
    <strong>9. DUE DILIGENCE; ACCESS; CONDITION.</strong> During the Option Term and, if the Option is exercised, until
    closing, Purchaser and Purchaser&rsquo;s representatives, inspectors, contractors, lenders, partners, agents,
    prospective assignees, and consultants may access the Property upon reasonable notice for inspections,
    measurements, photographs, videos, repair estimates, appraisals, surveys, financing, title review, and other
    due diligence. Seller shall reasonably cooperate with such access. Purchaser shall be responsible for damage
    to the Property caused by Purchaser or Purchaser&rsquo;s representatives during access. Unless otherwise agreed in
    writing, the Property is sold in its present &ldquo;as-is&rdquo; condition, subject to Seller&rsquo;s representations, required
    disclosures, title obligations, and any written repair agreements.
  </p>

  <p>
    <strong>10. ASSIGNMENT; INVESTOR DISCLOSURE.</strong> Purchaser may assign this Agreement and/or Purchaser&rsquo;s
    rights under the Option, in whole or in part, to any person or entity without Seller&rsquo;s further consent. Purchaser
    shall provide Seller written notice of any assignment before closing. Any assignee shall assume Purchaser&rsquo;s
    obligations for closing from and after the effective date of the assignment. Seller acknowledges that Purchaser
    may be a real estate investor, may seek to assign this Agreement or the Option for a fee or profit, and is not
    acting as Seller&rsquo;s real estate broker, agent, fiduciary, or representative unless a separate written agency
    agreement states otherwise. Purchaser shall comply with all applicable licensing, disclosure, advertising, and
    real estate laws.
  </p>

  <p>
    <strong>11. ESCROW / TITLE COMPANY.</strong> If any funds are to be held in escrow, they shall be held by: Name:
    ______________________________________________; Address:
    ______________________________________________; Phone/Email:
    ______________________________________________ (the &ldquo;Escrow Agent&rdquo;). The Escrow Agent shall apply
    funds at closing or release funds according to this Agreement, written instructions signed by the Parties, or
    applicable law.
  </p>

  <p>
    <strong>12. SELLER REPRESENTATIONS.</strong> Seller represents, to Seller&rsquo;s actual knowledge, that: (a) Seller has full
    authority to enter into and perform this Agreement; (b) no other person or entity has a superior right to
    purchase the Property; (c) Seller has not entered into any other contract, option, lease-option, or agreement to
    sell the Property that conflicts with this Agreement; (d) there are no undisclosed tenants, occupants, leases,
    rental agreements, or possession rights affecting the Property, except:
    ______________________________________________; (e) Seller has not received written notice of pending
    condemnation, litigation, code enforcement, or governmental action affecting the Property, except:
    ______________________________________________; and (f) Seller will not intentionally impair title or
    materially change the condition of the Property before closing, ordinary wear and tear excepted.
  </p>

  <p>
    <strong>13. REQUIRED DISCLOSURES.</strong> Seller shall provide Purchaser all disclosures required by federal, state, and
    local law, including, if applicable, lead-based paint disclosures for residential property built before 1978,
    property condition disclosures, homeowner association or condominium disclosures, septic/well disclosures,
    and any other notices required in the jurisdiction where the Property is located. Required disclosures are
    incorporated into this Agreement by reference.
  </p>

  <p>
    <strong>14. RISK OF LOSS; MAINTENANCE.</strong> Risk of loss or material damage to the Property shall remain with Seller
    until closing. Seller shall maintain the Property in substantially the same condition as of the Execution Date,
    reasonable wear and tear excepted, and shall not remove fixtures, appliances, or personal property included in
    the sale unless this Agreement states otherwise.
  </p>

  <p>
    <strong>15. PURCHASER DEFAULT.</strong> If Purchaser timely exercises the Option and then fails to close in violation of this
    Agreement, and such failure is not caused by Seller default, title defect, casualty, failure of a contingency, or
    other permitted termination right, Seller&rsquo;s sole and exclusive remedy shall be to retain the Option Fee as
    liquidated damages. The Parties agree that actual damages would be difficult to determine and that the Option
    Fee is a reasonable estimate of Seller&rsquo;s damages. Seller shall have no further claim against Purchaser for
    money damages, consequential damages, or specific performance.
  </p>

  <p>
    <strong>16. SELLER DEFAULT.</strong> If Seller fails or refuses to perform under this Agreement, including by refusing to
    honor the Option, refusing to close after timely exercise, entering into a conflicting agreement, or failing to
    deliver title as required, Purchaser may pursue any remedies available at law or in equity, including specific
    performance, injunctive relief, return of amounts paid, costs, and money damages, subject to applicable
    law.
  </p>

  <p>
    <strong>17. MEMORANDUM OF OPTION.</strong> At Purchaser&rsquo;s request, Seller shall execute a short-form memorandum of
    this Agreement suitable for recording in the land records of the jurisdiction where the Property is located. The
    memorandum shall not disclose the Purchase Price unless required by law. If the Option expires without
    exercise or this Agreement is terminated, Purchaser shall reasonably cooperate in recording a release of the
    memorandum.
  </p>

  <p>
    <strong>18. NOTICES.</strong> Any notice required or permitted under this Agreement shall be in writing and delivered by
    personal delivery, recognized overnight courier, certified mail, or email to the addresses below, or to any
    updated address provided by written notice. Notice shall be deemed given upon delivery, refusal of delivery,
    confirmed email transmission, or attempted delivery to the correct address. Seller notice address/email:
    ${u(data.seller_address || '')}. Purchaser notice address/email:
    ${u(data.purchaser_address)}.
  </p>

  <p>
    <strong>19. BROKERS.</strong> Each Party represents that no broker, agent, or finder is entitled to a commission or fee in
    connection with this Agreement, except: ______________________________. The Party
    whose conduct creates a broker claim shall indemnify the other Party from that claim, subject to applicable law.
  </p>

  <p>
    <strong>20. GOVERNING LAW; VENUE.</strong> This Agreement shall be governed by and construed according to the laws of
    the State/Commonwealth where the Property is located. Venue for any legal action shall be in a court of competent jurisdiction in
    the county or city where the Property is located, unless applicable law requires otherwise.
  </p>

  <p>
    <strong>21. SUCCESSORS AND ASSIGNS.</strong> This Agreement shall bind and benefit the Parties and their respective
    heirs, personal representatives, successors, permitted assigns, and legal representatives.
  </p>

  <p>
    <strong>22. ENTIRE AGREEMENT; AMENDMENTS.</strong> This Agreement contains the entire agreement between the
    Parties regarding the Option and purchase of the Property and supersedes all prior oral or written discussions,
    offers, negotiations, and agreements. This Agreement may be amended only by a written document signed by
    both Parties.
  </p>

  <p>
    <strong>23. COUNTERPARTS; ELECTRONIC SIGNATURES.</strong> This Agreement may be signed in counterparts, each of
    which is deemed an original and all of which together constitute one agreement. Signatures delivered
    electronically, by scanned copy, or through an electronic signature platform shall be effective as originals to the
    fullest extent permitted by applicable law.
  </p>

  <p>
    <strong>24. SEVERABILITY.</strong> If any provision of this Agreement is held invalid or unenforceable, the remaining
    provisions shall remain in effect to the greatest extent permitted by law, and the invalid or unenforceable
    provision shall be modified to the minimum extent necessary to make it valid and enforceable.
  </p>

  <p>
    <strong>25. AUTHORITY; VOLUNTARY AGREEMENT.</strong> Each person signing this Agreement represents that such
    person has authority to sign and bind the Party on whose behalf the person signs. The Parties acknowledge
    that they have had the opportunity to consult legal counsel and that they are signing this Agreement voluntarily.
  </p>

  <p style="margin-top: 28px;">
    IN WITNESS WHEREOF, the Parties have executed this Agreement as of the dates written below.
  </p>

  <div style="margin-top: 32px; page-break-inside: avoid;">
    <div style="display: flex; gap: 48px;">
      <div style="flex: 1;">
        <p style="font-weight: bold; margin-bottom: 12px;">SELLER</p>
        <p>Signature:</p>
        ${sigImg(sellerSignature)}
        <p style="margin-top: 8px;">Printed Name: ${u(data.seller_name)}</p>
        <p>Title/Capacity, if any: ______________________</p>
        <p>Date: __________________, 20${u(year)}</p>
      </div>
      <div style="flex: 1;">
        <p style="font-weight: bold; margin-bottom: 12px;">PURCHASER</p>
        <p>Signature:</p>
        ${sigImg(purchaserSignature)}
        <p style="margin-top: 8px;">Printed Name: ${u(data.purchaser_name)}</p>
        <p>Title/Capacity, if any: ______________________</p>
        <p>Date: ${u(month)} ${u(day)}, 20${u(year)}</p>
      </div>
    </div>
  </div>

  <div style="margin-top: 48px; page-break-before: auto;">
    <h2 style="text-align: center; font-size: 16px; font-weight: bold;">EXHIBIT A</h2>
    <p style="text-align: center; margin-bottom: 16px;">LEGAL DESCRIPTION OF PROPERTY</p>
    <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
    <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
    <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
    <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
  </div>
</div>`
}
