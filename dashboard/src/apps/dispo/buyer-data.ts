export type BuyerType = 'cash' | 'jv'

export interface Buyer {
  name: string
  phone?: string
  email?: string
  website?: string
  buys: string
  model: string
  counties: string[]
  state: 'OH' | 'TX' | 'BOTH'
  market: string
  tier: 1 | 2
  type: BuyerType
  tags: string[]
  evidence?: string
}

export interface CountyData {
  county: string
  state: 'OH' | 'TX'
  leads: number
  cities: string
}

export const COUNTY_DATA: CountyData[] = [
  { county: 'Cuyahoga', state: 'OH', leads: 276, cities: 'Cleveland, Lakewood, Euclid, Maple Heights' },
  { county: 'Franklin', state: 'OH', leads: 144, cities: 'Columbus, Grove City, Westerville, Reynoldsburg' },
  { county: 'Hamilton', state: 'OH', leads: 71, cities: 'Cincinnati' },
  { county: 'Montgomery', state: 'OH', leads: 52, cities: 'Dayton, Moraine, Vandalia' },
  { county: 'Summit', state: 'OH', leads: 47, cities: 'Akron, Stow, Barberton' },
  { county: 'Lucas', state: 'OH', leads: 34, cities: 'Toledo, Maumee, Oregon' },
  { county: 'Stark', state: 'OH', leads: 33, cities: 'Canton, Massillon, Canal Fulton' },
  { county: 'Mahoning', state: 'OH', leads: 31, cities: 'Youngstown, Girard, Campbell' },
  { county: 'Lake', state: 'OH', leads: 30, cities: 'Mentor, Willowick, Eastlake' },
  { county: 'Lorain', state: 'OH', leads: 27, cities: 'Elyria, Lorain, Amherst' },
  { county: 'Butler', state: 'OH', leads: 26, cities: 'Hamilton, Middletown, Fairfield' },
  { county: 'Trumbull', state: 'OH', leads: 23, cities: 'Warren, Niles, Hubbard' },
  { county: 'Greene', state: 'OH', leads: 17, cities: 'Xenia, Beavercreek, Fairborn' },
  { county: 'Clark', state: 'OH', leads: 16, cities: 'Springfield, New Carlisle' },
  { county: 'Warren', state: 'OH', leads: 11, cities: 'Franklin, Springboro, Waynesville' },
  { county: 'Harris', state: 'TX', leads: 253, cities: 'Houston, Pasadena, Humble, Spring, Baytown' },
  { county: 'Bexar', state: 'TX', leads: 147, cities: 'San Antonio, Converse, Universal City' },
  { county: 'Dallas', state: 'TX', leads: 85, cities: 'Dallas, Garland, Mesquite, Irving' },
  { county: 'Tarrant', state: 'TX', leads: 79, cities: 'Fort Worth, Arlington, Euless, Hurst' },
  { county: 'Travis', state: 'TX', leads: 26, cities: 'Austin, Pflugerville, Cedar Park' },
  { county: 'Fort Bend', state: 'TX', leads: 18, cities: 'Katy, Missouri City, Stafford' },
  { county: 'Collin', state: 'TX', leads: 17, cities: 'Plano, Wylie, Allen, McKinney' },
]

export const BUYERS: Buyer[] = [
  // === HOUSTON — CASH BUYERS ===
  { name: 'Absolute Properties HTX', phone: '(713) 230-8059', email: 'info@absolutepropertieshtx.com', website: 'absolutepropertieshtx.com/wholesalers', buys: 'SFR any condition', model: 'Cash buy/flip, BBB A+', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 1, type: 'cash', tags: ['priority', 'wholesaler-page'], evidence: 'Dedicated /wholesalers page' },
  { name: 'Houston House Buyers', email: 'info@houstonhousebuyers.com', buys: 'Distressed SFR', model: '500+ buyer network, ARV x 70-85%', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 1, type: 'cash', tags: ['priority'], evidence: 'Network of 500+ cash buyers' },
  { name: 'My House Investments', phone: '(956) 336-8368', email: 'sales@myhouseinvestments.com', buys: 'SFR, land, commercial', model: 'Direct buyer + wholesale contracts', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 1, type: 'cash', tags: [], evidence: 'Does wholesale contracts' },
  { name: 'Sell House Houston', phone: '(346) 545-5436', buys: 'SFR, multifamily, mobile, land, commercial', model: 'Cash buyer + assignment', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 1, type: 'cash', tags: [], evidence: 'Collaborates with wholesalers' },
  { name: 'American Home Buyer', phone: '(713) 255-9850', buys: 'SFR flooded/inherited/foreclosure', model: 'Cash buyer since 1998', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 1, type: 'cash', tags: [], evidence: 'Offers wholesale option' },
  { name: 'AMI House Buyers', phone: '(832) 409-1116', email: 'hello@amihousebuyers.com', buys: 'SFR, land, apartments, storage', model: 'Direct buyer + investor matching', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 1, type: 'cash', tags: ['fort-bend'], evidence: 'Wholesale deals in Katy/West Houston' },
  { name: 'Houston Capital Home Buyers', phone: '(713) 581-9075', email: 'info@HoustonCapitalHomeBuyers.com', buys: 'SFR, mobile parks, commercial', model: 'BBB A+, since 2014', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: [] },
  { name: 'Flash Home Buyers', phone: '(281) 801-6332', email: 'Info@FlashHomeBuyers.com', buys: 'SFR', model: 'Licensed brokerage + cash buyer', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: [] },
  { name: 'Homes4Investors', phone: '(281) 668-8010', email: 'Info@homes4investors.com', buys: 'SFR at 30-50% off retail', model: 'Deal-flow partner for rehabbers', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: ['fort-bend'] },
  { name: 'Stephen Buys Houses', buys: 'SFR', model: 'Direct buyer, Channelview HQ', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: [] },
  { name: 'Irie Properties', phone: '(832) 225-4488', buys: 'SFR', model: 'Founded 2006', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: [] },
  { name: 'PPS House Buyers', phone: '(281) 306-5055', buys: 'SFR', model: 'Direct buyer', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: [] },
  { name: 'StepUp Home Buyers', phone: '(832) 413-1437', buys: 'Flood/tax-lien/probate/divorce', model: 'Direct buyer', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 2, type: 'cash', tags: [] },

  // === HOUSTON — JV PARTNERS ===
  { name: '77 Realty Solutions', phone: '(713) 366-4866', email: 'info@77realtysolutions.com', buys: 'SFR + vacant land', model: 'Takes your contract, finds buyer, splits assignment fee', counties: ['Harris'], state: 'TX', market: 'Houston', tier: 1, type: 'jv', tags: ['jv-partner'], evidence: 'JV deals for wholesalers, 2-3 week close' },
  { name: 'Senna House Buyers', phone: '(713) 489-8000', buys: 'Distressed, inherited, foreclosure', model: '90-day transactional funding for double-closes', counties: ['Harris', 'Fort Bend'], state: 'TX', market: 'Houston', tier: 1, type: 'jv', tags: ['transactional-funder'], evidence: 'Funds wholesaler EMD, no personal capital needed' },

  // === DFW — CASH BUYERS ===
  { name: 'Dallas Property Investors', phone: '(214) 609-1240', email: 'marco@dallaspropertyinvestors.com', buys: 'Houses any condition', model: 'Cash, sub-to, wraps, assignments', counties: ['Dallas', 'Tarrant'], state: 'TX', market: 'DFW', tier: 1, type: 'cash', tags: ['priority'], evidence: 'Lists wholesale assignments as standard path' },
  { name: 'Southern Hills Home Buyers', phone: '(214) 225-3042', buys: 'Houses, multifamily, lots', model: 'DFW cash buyer network', counties: ['Dallas', 'Tarrant', 'Collin'], state: 'TX', market: 'DFW', tier: 2, type: 'cash', tags: [] },
  { name: 'DFW Investors', phone: '(214) 444-7926', buys: 'SFR', model: 'Since 1997, 50-100/yr', counties: ['Dallas', 'Tarrant'], state: 'TX', market: 'DFW', tier: 2, type: 'cash', tags: [] },
  { name: 'We Buy North Texas Homes', phone: '(214) 227-7669', email: 'jason@wbnth.com', buys: 'SFR', model: 'Direct buyer', counties: ['Collin', 'Dallas'], state: 'TX', market: 'DFW', tier: 2, type: 'cash', tags: [] },
  { name: 'Legacy Home Buyers', phone: '(469) 771-0915', buys: 'SFR', model: 'Own funds buyer', counties: ['Dallas', 'Tarrant', 'Collin'], state: 'TX', market: 'DFW', tier: 2, type: 'cash', tags: [] },
  { name: 'Love Investors', phone: '(817) 751-7476', buys: 'SFR, many property types', model: 'Direct buyer', counties: ['Dallas', 'Tarrant'], state: 'TX', market: 'DFW', tier: 2, type: 'cash', tags: [] },
  { name: 'Four 19 Properties', phone: '(817) 646-8860', email: 'info@four19properties.com', buys: 'SFR', model: 'Direct buyer', counties: ['Dallas', 'Tarrant'], state: 'TX', market: 'DFW', tier: 2, type: 'cash', tags: [] },

  // === DFW — JV PARTNERS ===
  { name: 'Dallas Homes for Cash', phone: '(469) 305-0988', email: 'team@dallashomesforcash.com', website: 'dallashomesforcash.com/wholesalers', buys: 'SFR', model: 'JV: you contract, they bring buyer from investor network', counties: ['Dallas', 'Collin'], state: 'TX', market: 'DFW', tier: 1, type: 'jv', tags: ['priority', 'jv-partner', 'wholesaler-page'], evidence: 'Dedicated /wholesalers page with JV structure' },

  // === SAN ANTONIO — CASH BUYERS ===
  { name: 'House Buyer San Antonio', phone: '(210) 547-7505', buys: 'Houses + vacant land', model: 'Since 2009, BBB A+, 7-day close', counties: ['Bexar'], state: 'TX', market: 'San Antonio', tier: 1, type: 'cash', tags: ['priority'], evidence: 'Assigns to vetted investor network' },
  { name: 'San Antonio Home Buyers', phone: '(726) 240-2509', buys: 'SFR, multifamily, condos, mobile, commercial', model: 'Cash buyer, 7-14 day close', counties: ['Bexar'], state: 'TX', market: 'San Antonio', tier: 1, type: 'cash', tags: ['priority'], evidence: 'Wholesale assignments in service menu' },
  { name: 'Superior Realty Group', phone: '(210) 368-6573', buys: 'Distressed multifamily, commercial, SFR, REOs', model: 'Wholesale cash buyer, ~7-day close', counties: ['Bexar'], state: 'TX', market: 'San Antonio', tier: 1, type: 'cash', tags: [] },
  { name: 'Solution House Buyers', phone: '(210) 405-5578', buys: 'SFR', model: 'Since 1998, private-lender funded', counties: ['Bexar'], state: 'TX', market: 'San Antonio', tier: 1, type: 'cash', tags: [] },
  { name: 'Texas Equity Connect', phone: '(346) 214-6340', email: 'deals@texasequityconnect.com', buys: 'Off-market distressed/probate/pre-foreclosure', model: 'Buyer matching network, 100+ cities', counties: ['Bexar', 'Travis', 'Harris'], state: 'TX', market: 'San Antonio', tier: 1, type: 'cash', tags: ['buyer-network'], evidence: 'Wholesale-deal-to-buyer matching network' },
  { name: 'Alamo City Housebuyer', phone: '(210) 853-2446', buys: 'Probate, pre-foreclosure, fire/flood', model: 'Direct buyer', counties: ['Bexar'], state: 'TX', market: 'San Antonio', tier: 2, type: 'cash', tags: [] },
  { name: 'Dr Cash Home Buyers (SA)', phone: '(210) 265-6611', email: 'raymond@drcashhomebuyers.com', buys: 'SFR', model: 'Rehabber/landlord', counties: ['Bexar'], state: 'TX', market: 'San Antonio', tier: 2, type: 'cash', tags: [] },

  // === AUSTIN — CASH BUYERS ===
  { name: 'Reivesti (Austin)', phone: '(888) 897-1113', email: 'support@reivesti.com', buys: 'SFR, multifamily, land, commercial', model: '25,000+ preferred buyers', counties: ['Travis'], state: 'TX', market: 'Austin', tier: 1, type: 'cash', tags: ['buyer-network'], evidence: 'Dedicated wholesaler partner page' },
  { name: 'Austin Flipsters / Houndstooth Capital', website: 'houndstoothcapital.com', buys: 'Distressed SFR for flip', model: '100+ flips, $100M+ acquired', counties: ['Travis'], state: 'TX', market: 'Austin', tier: 2, type: 'cash', tags: [] },

  // === CLEVELAND / NE OHIO — CASH BUYERS ===
  { name: 'Double E Homebuyers', phone: '(832) 360-3474', email: 'Jbrandon@doubleehomebuyers.com', buys: 'SFR any condition', model: 'Funds wholesaler EMD, ~11-day close', counties: ['Cuyahoga'], state: 'OH', market: 'Cleveland', tier: 1, type: 'cash', tags: ['priority', 'funds-emd'], evidence: 'Funds wholesaler earnest money' },
  { name: 'Turbo Realty LLC', buys: 'Distressed SFR $35K-$237K', model: 'Flip supply chain', counties: ['Cuyahoga'], state: 'OH', market: 'Cleveland', tier: 1, type: 'cash', tags: [] },
  { name: 'Global Real Estate Solutions', phone: '(330) 969-4175', buys: 'SFR discounted/distressed', model: '7-day close, wholesale deals', counties: ['Stark'], state: 'OH', market: 'Cleveland', tier: 1, type: 'cash', tags: [] },
  { name: 'Turner & Partners', phone: '(512) 400-4457', email: 'sales@turnerandpartners.com', buys: 'Fix-and-flip, small multifamily', model: '100+ assignments since 2020', counties: ['Cuyahoga', 'Franklin'], state: 'BOTH', market: 'Cleveland', tier: 1, type: 'cash', tags: [], evidence: 'Offers assignment opportunities' },
  { name: 'Cleveland Wholesale Investments', email: 'info@closeyourhome4cash.com', buys: 'SFR, multifamily, apartments, commercial', model: 'Discounted acquisition, exclusive buyer list', counties: ['Cuyahoga'], state: 'OH', market: 'Cleveland', tier: 2, type: 'cash', tags: [] },
  { name: 'RAMM Home Buyers', phone: '(330) 203-7131', buys: 'SFR, condos, duplexes, multifamily, land', model: 'Direct buyer/renovator', counties: ['Summit', 'Stark', 'Cuyahoga'], state: 'OH', market: 'Cleveland', tier: 2, type: 'cash', tags: [] },
  { name: 'Northeast Ohio Home Buyers', phone: '(330) 765-9509', buys: 'SFR', model: 'Direct buyer since 2018', counties: ['Stark', 'Summit'], state: 'OH', market: 'Cleveland', tier: 2, type: 'cash', tags: [] },
  { name: 'Finally Sold', buys: 'SFR', model: '~10-day close, ready capital', counties: ['Mahoning', 'Trumbull'], state: 'OH', market: 'Cleveland', tier: 2, type: 'cash', tags: [] },
  { name: 'Lorain County Homebuyers', buys: 'SFR', model: 'Active since 2019', counties: ['Lorain'], state: 'OH', market: 'Cleveland', tier: 2, type: 'cash', tags: [] },
  { name: 'Overland Properties', website: 'overland-properties.com', buys: 'SFR/multifamily for investors', model: '1,500+ units, 700+ investors', counties: ['Cuyahoga', 'Lake'], state: 'OH', market: 'Cleveland', tier: 2, type: 'cash', tags: [] },

  // === CLEVELAND — JV PARTNERS ===
  { name: 'Sesa Properties', phone: '(216) 877-8430', buys: 'SFR, multifamily, vacant land', model: 'JV wholesaling — 1,000+ cash investor list', counties: ['Cuyahoga', 'Lake', 'Lorain'], state: 'OH', market: 'Cleveland', tier: 1, type: 'jv', tags: ['jv-partner'], evidence: 'JV wholesaling, only paid if they bring buyer and close' },

  // === COLUMBUS — CASH BUYERS ===
  { name: 'Columbus Home Buyers', phone: '(380) 249-8143', website: 'housebuyerscolumbus.com', buys: 'SFR, duplex/triplex, land, mobile, condos', model: 'Cash buyer, 7-14 day close', counties: ['Franklin'], state: 'OH', market: 'Columbus', tier: 1, type: 'cash', tags: ['priority'], evidence: 'Collaborates with wholesalers' },
  { name: 'Homesmith OH', phone: '(614) 401-3651', email: 'bsmith@homesmith.com', buys: 'Any-condition SFR', model: 'Fix/flip + wholesale buyers list', counties: ['Franklin'], state: 'OH', market: 'Columbus', tier: 1, type: 'cash', tags: [] },
  { name: 'CORI LLC', phone: '(614) 961-0169', buys: 'Distressed/foreclosure/fire-damaged SFR', model: 'VIP Property Deals list', counties: ['Franklin'], state: 'OH', market: 'Columbus', tier: 1, type: 'cash', tags: [] },
  { name: 'Discover Wholesale Houses', phone: '(614) 683-4440', buys: 'Foreclosure, REO, multifamily', model: '30-50% below market deals', counties: ['Franklin'], state: 'OH', market: 'Columbus', tier: 1, type: 'cash', tags: [] },
  { name: 'Ohio Cash Buyers', phone: '(513) 815-5000', buys: 'SFR any condition', model: 'A+ BBB, ~$4M revenue', counties: ['Franklin', 'Hamilton', 'Montgomery'], state: 'OH', market: 'Columbus', tier: 2, type: 'cash', tags: [] },
  { name: 'Columbus Cash Buyers', phone: '(614) 665-5353', buys: 'As-is distressed SFR', model: 'Founded 2020', counties: ['Franklin'], state: 'OH', market: 'Columbus', tier: 2, type: 'cash', tags: [] },

  // === CINCINNATI — CASH BUYERS ===
  { name: 'Cincinnati Home Buyers', phone: '(513) 447-6158', buys: 'SFR, multifamily, condos, land, commercial', model: 'Cash buyer, 7-14 day close', counties: ['Hamilton'], state: 'OH', market: 'Cincinnati', tier: 1, type: 'cash', tags: ['priority'], evidence: 'Dedicated wholesaler page' },
  { name: 'Rapid Fire Investments', phone: '(859) 229-3523', email: 'joseph@rapidfireinvestments.com', buys: 'Off-market properties', model: '503 deals in 2025', counties: ['Hamilton', 'Butler'], state: 'OH', market: 'Cincinnati', tier: 1, type: 'cash', tags: ['priority'], evidence: 'REIAGC wholesaler vendor' },
  { name: 'We Really Do Buy Houses', phone: '(513) 471-0141', email: 'drewwhitepix@gmail.com', buys: 'Wholesale deals', model: 'Can pay full price', counties: ['Hamilton'], state: 'OH', market: 'Cincinnati', tier: 1, type: 'cash', tags: [], evidence: 'REIAGC-listed vendor' },
  { name: 'Wholesale Cincinnati Houses', phone: '(513) 438-8016', email: 'sales@wholesalecincinnatihouses.com', buys: 'As-is at 50% discount', model: 'Investor-criteria intake', counties: ['Hamilton'], state: 'OH', market: 'Cincinnati', tier: 1, type: 'cash', tags: [] },
  { name: 'ALMA Holdings', phone: '(513) 476-4656', email: 'adam@almaholdingsgroup.com', buys: 'Distressed residential + notes', model: 'Seller financing up to 80% LTV', counties: ['Warren', 'Hamilton'], state: 'OH', market: 'Cincinnati', tier: 1, type: 'cash', tags: [] },
  { name: 'Sztanyo and Sons', phone: '(859) 412-1940', buys: 'Foreclosures, bank-owned, fixers', model: '30-50% off retail, preferred buyers', counties: ['Hamilton'], state: 'OH', market: 'Cincinnati', tier: 2, type: 'cash', tags: [] },
  { name: 'D 57 Investments', phone: '(513) 478-1735', buys: 'SFR any condition', model: 'Direct buyer', counties: ['Hamilton', 'Butler'], state: 'OH', market: 'Cincinnati', tier: 2, type: 'cash', tags: [] },
  { name: 'Burnett Home Buyers', phone: '(513) 438-8169', buys: 'SFR, townhomes, distressed', model: 'Since 2016', counties: ['Hamilton', 'Butler', 'Warren'], state: 'OH', market: 'Cincinnati', tier: 2, type: 'cash', tags: [] },

  // === DAYTON + TOLEDO — CASH BUYERS ===
  { name: 'KeyGlee', phone: '(480) 579-3913', email: 'Help@KeyGlee.com', website: 'keyglee.com/submit-a-wholesale-property', buys: 'Any wholesale-assignable property', model: 'National dispo company', counties: ['Montgomery', 'Clark', 'Lucas'], state: 'OH', market: 'Dayton/Toledo', tier: 1, type: 'cash', tags: [], evidence: 'Submit-a-wholesale-property page' },
  { name: 'Bernath Holdings', phone: '(419) 540-8311', email: 'chris@bernathholdings.com', buys: 'Multifamily, commercial, SFR, REOs', model: 'VIP wholesale investor list', counties: ['Lucas'], state: 'OH', market: 'Dayton/Toledo', tier: 1, type: 'cash', tags: [] },
  { name: 'Point Management / Kraner Family', phone: '(937) 684-3246', buys: 'Distressed multifamily, commercial, SFR', model: 'Investing since 1996', counties: ['Montgomery', 'Greene'], state: 'OH', market: 'Dayton/Toledo', tier: 1, type: 'cash', tags: [] },
  { name: 'Venture Real Estate Group', phone: '(513) 424-1550', buys: 'Distressed SFR, multifamily, commercial', model: 'VIP Property Deals list', counties: ['Montgomery', 'Greene', 'Clark', 'Lucas'], state: 'OH', market: 'Dayton/Toledo', tier: 1, type: 'cash', tags: [] },
]

export const CITY_TO_COUNTY: Record<string, string> = {
  // Ohio
  'Cleveland': 'Cuyahoga', 'Maple Heights': 'Cuyahoga', 'Bedford': 'Cuyahoga',
  'Lakewood': 'Cuyahoga', 'North Olmsted': 'Cuyahoga', 'Euclid': 'Cuyahoga',
  'Seven Hills': 'Cuyahoga', 'Rocky River': 'Cuyahoga', 'Berea': 'Cuyahoga',
  'Brecksville': 'Cuyahoga', 'Independence': 'Cuyahoga', 'Garfield Heights': 'Cuyahoga',
  'Cleveland Heights': 'Cuyahoga', 'Beachwood': 'Cuyahoga', 'University Heights': 'Cuyahoga',
  'Solon': 'Cuyahoga', 'Broadview Heights': 'Cuyahoga', 'North Royalton': 'Cuyahoga',
  'Strongsville': 'Cuyahoga', 'Westlake': 'Cuyahoga', 'Northfield': 'Cuyahoga',
  'South Euclid': 'Cuyahoga', 'Bay Village': 'Cuyahoga', 'Olmsted Falls': 'Cuyahoga',
  'Warrensville Heights': 'Cuyahoga',
  'Columbus': 'Franklin', 'Grove City': 'Franklin', 'Westerville': 'Franklin',
  'Reynoldsburg': 'Franklin', 'Groveport': 'Franklin', 'Hilliard': 'Franklin',
  'Galloway': 'Franklin', 'Worthington': 'Franklin', 'Canal Winchester': 'Franklin',
  'Cincinnati': 'Hamilton', 'Norwood': 'Hamilton', 'Blue Ash': 'Hamilton',
  'Loveland': 'Hamilton', 'Montgomery': 'Hamilton', 'Mason': 'Hamilton',
  'Hamilton': 'Butler', 'Middletown': 'Butler', 'Fairfield': 'Butler',
  'West Chester': 'Butler', 'Monroe': 'Butler', 'Trenton': 'Butler', 'Oxford': 'Butler',
  'Dayton': 'Montgomery', 'Moraine': 'Montgomery', 'Vandalia': 'Montgomery',
  'Miamisburg': 'Montgomery', 'Germantown': 'Montgomery',
  'Toledo': 'Lucas', 'Maumee': 'Lucas', 'Oregon': 'Lucas', 'Sylvania': 'Lucas', 'Holland': 'Lucas',
  'Akron': 'Summit', 'Stow': 'Summit', 'Barberton': 'Summit', 'Tallmadge': 'Summit',
  'Cuyahoga Falls': 'Summit', 'Hudson': 'Summit', 'Norton': 'Summit',
  'Canton': 'Stark', 'Canal Fulton': 'Stark', 'Louisville': 'Stark', 'Massillon': 'Stark',
  'North Canton': 'Stark', 'Navarre': 'Stark',
  'Youngstown': 'Mahoning', 'Girard': 'Mahoning', 'Campbell': 'Mahoning', 'Struthers': 'Mahoning',
  'Elyria': 'Lorain', 'Lorain': 'Lorain', 'Amherst': 'Lorain', 'North Ridgeville': 'Lorain', 'Avon': 'Lorain',
  'Willowick': 'Lake', 'Mentor': 'Lake', 'Eastlake': 'Lake', 'Painesville': 'Lake',
  'Willoughby': 'Lake', 'Wickliffe': 'Lake',
  'Warren': 'Trumbull', 'Niles': 'Trumbull', 'Hubbard': 'Trumbull',
  'Xenia': 'Greene', 'Beavercreek': 'Greene', 'Fairborn': 'Greene', 'Bellbrook': 'Greene',
  'Springfield': 'Clark', 'New Carlisle': 'Clark',
  'Waynesville': 'Warren', 'Springboro': 'Warren', 'Franklin': 'Warren', 'Maineville': 'Warren',
  // Texas
  'Houston': 'Harris', 'Pasadena': 'Harris', 'Humble': 'Harris', 'Spring': 'Harris',
  'Baytown': 'Harris', 'Channelview': 'Harris', 'Crosby': 'Harris',
  'Deer Park': 'Harris', 'Tomball': 'Harris', 'Cypress': 'Harris', 'Pearland': 'Harris',
  'Jersey Village': 'Harris', 'Kingwood': 'Harris', 'Webster': 'Harris', 'La Porte': 'Harris',
  'San Antonio': 'Bexar', 'Universal City': 'Bexar', 'Converse': 'Bexar', 'Helotes': 'Bexar',
  'Dallas': 'Dallas', 'Garland': 'Dallas', 'Mesquite': 'Dallas', 'Irving': 'Dallas',
  'Desoto': 'Dallas', 'Grand Prairie': 'Dallas', 'Carrollton': 'Dallas', 'Seagoville': 'Dallas',
  'Cedar Hill': 'Dallas', 'Richardson': 'Dallas', 'Duncanville': 'Dallas', 'Lancaster': 'Dallas',
  'Rowlett': 'Dallas', 'Glenn Heights': 'Dallas',
  'Fort Worth': 'Tarrant', 'Arlington': 'Tarrant', 'Euless': 'Tarrant', 'Hurst': 'Tarrant',
  'North Richland Hills': 'Tarrant', 'Watauga': 'Tarrant', 'Haltom City': 'Tarrant',
  'Bedford': 'Tarrant', 'Benbrook': 'Tarrant', 'Mansfield': 'Tarrant', 'Forest Hill': 'Tarrant',
  'Plano': 'Collin', 'Wylie': 'Collin', 'Anna': 'Collin', 'Princeton': 'Collin',
  'Allen': 'Collin', 'Mckinney': 'Collin', 'McKinney': 'Collin',
  'Austin': 'Travis', 'Pflugerville': 'Travis', 'Cedar Park': 'Travis', 'Round Rock': 'Travis',
  'Katy': 'Fort Bend', 'Missouri City': 'Fort Bend', 'Stafford': 'Fort Bend',
}

export function getCountyForCity(city: string, state: string): string | null {
  const county = CITY_TO_COUNTY[city]
  if (county) return county
  const titleCity = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  return CITY_TO_COUNTY[titleCity] || null
}

export function getBuyersForCounty(county: string): { cash: Buyer[]; jv: Buyer[] } {
  const matching = BUYERS.filter(b => b.counties.includes(county))
  return {
    cash: matching.filter(b => b.type === 'cash'),
    jv: matching.filter(b => b.type === 'jv'),
  }
}
