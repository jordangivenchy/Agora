/* Where a person lives: the countries, and the states of the United
   States, that the agreement step and Settings offer. Shared by the
   website and the phone app (this folder is the one both builds read).

   Countries are ISO 3166-1's two-letter codes, plus Kosovo's XK, under
   their everyday English names (Unicode CLDR's, a few made plainer),
   already in A-to-Z order. A state is stored the way ISO 3166-2 writes
   it: "US-CA". The database checks the same shapes (accept_terms,
   set_my_place). */

export type Place = readonly [code: string, name: string];

const pairs = (raw: string, prefix = ""): Place[] =>
  raw.split("\n").map((line) => [prefix + line.slice(0, 2), line.slice(3)] as const);

export const COUNTRIES: readonly Place[] = pairs(`AF Afghanistan
AX Åland Islands
AL Albania
DZ Algeria
AS American Samoa
AD Andorra
AO Angola
AI Anguilla
AQ Antarctica
AG Antigua & Barbuda
AR Argentina
AM Armenia
AW Aruba
AU Australia
AT Austria
AZ Azerbaijan
BS Bahamas
BH Bahrain
BD Bangladesh
BB Barbados
BY Belarus
BE Belgium
BZ Belize
BJ Benin
BM Bermuda
BT Bhutan
BO Bolivia
BA Bosnia & Herzegovina
BW Botswana
BV Bouvet Island
BR Brazil
IO British Indian Ocean Territory
VG British Virgin Islands
BN Brunei
BG Bulgaria
BF Burkina Faso
BI Burundi
KH Cambodia
CM Cameroon
CA Canada
CV Cape Verde
BQ Caribbean Netherlands
KY Cayman Islands
CF Central African Republic
TD Chad
CL Chile
CN China
CX Christmas Island
CC Cocos (Keeling) Islands
CO Colombia
KM Comoros
CG Congo - Brazzaville
CD Congo - Kinshasa
CK Cook Islands
CR Costa Rica
CI Côte d’Ivoire
HR Croatia
CU Cuba
CW Curaçao
CY Cyprus
CZ Czechia
DK Denmark
DJ Djibouti
DM Dominica
DO Dominican Republic
EC Ecuador
EG Egypt
SV El Salvador
GQ Equatorial Guinea
ER Eritrea
EE Estonia
SZ Eswatini
ET Ethiopia
FK Falkland Islands
FO Faroe Islands
FJ Fiji
FI Finland
FR France
GF French Guiana
PF French Polynesia
TF French Southern Territories
GA Gabon
GM Gambia
GE Georgia
DE Germany
GH Ghana
GI Gibraltar
GR Greece
GL Greenland
GD Grenada
GP Guadeloupe
GU Guam
GT Guatemala
GG Guernsey
GN Guinea
GW Guinea-Bissau
GY Guyana
HT Haiti
HM Heard & McDonald Islands
HN Honduras
HK Hong Kong
HU Hungary
IS Iceland
IN India
ID Indonesia
IR Iran
IQ Iraq
IE Ireland
IM Isle of Man
IL Israel
IT Italy
JM Jamaica
JP Japan
JE Jersey
JO Jordan
KZ Kazakhstan
KE Kenya
KI Kiribati
XK Kosovo
KW Kuwait
KG Kyrgyzstan
LA Laos
LV Latvia
LB Lebanon
LS Lesotho
LR Liberia
LY Libya
LI Liechtenstein
LT Lithuania
LU Luxembourg
MO Macao
MG Madagascar
MW Malawi
MY Malaysia
MV Maldives
ML Mali
MT Malta
MH Marshall Islands
MQ Martinique
MR Mauritania
MU Mauritius
YT Mayotte
MX Mexico
FM Micronesia
MD Moldova
MC Monaco
MN Mongolia
ME Montenegro
MS Montserrat
MA Morocco
MZ Mozambique
MM Myanmar
NA Namibia
NR Nauru
NP Nepal
NL Netherlands
NC New Caledonia
NZ New Zealand
NI Nicaragua
NE Niger
NG Nigeria
NU Niue
NF Norfolk Island
KP North Korea
MK North Macedonia
MP Northern Mariana Islands
NO Norway
OM Oman
PK Pakistan
PW Palau
PS Palestine
PA Panama
PG Papua New Guinea
PY Paraguay
PE Peru
PH Philippines
PN Pitcairn Islands
PL Poland
PT Portugal
PR Puerto Rico
QA Qatar
RE Réunion
RO Romania
RU Russia
RW Rwanda
WS Samoa
SM San Marino
ST São Tomé & Príncipe
SA Saudi Arabia
SN Senegal
RS Serbia
SC Seychelles
SL Sierra Leone
SG Singapore
SX Sint Maarten
SK Slovakia
SI Slovenia
SB Solomon Islands
SO Somalia
ZA South Africa
GS South Georgia & South Sandwich Islands
KR South Korea
SS South Sudan
ES Spain
LK Sri Lanka
BL St. Barthélemy
SH St. Helena
KN St. Kitts & Nevis
LC St. Lucia
MF St. Martin
PM St. Pierre & Miquelon
VC St. Vincent & Grenadines
SD Sudan
SR Suriname
SJ Svalbard & Jan Mayen
SE Sweden
CH Switzerland
SY Syria
TW Taiwan
TJ Tajikistan
TZ Tanzania
TH Thailand
TL Timor-Leste
TG Togo
TK Tokelau
TO Tonga
TT Trinidad & Tobago
TN Tunisia
TR Türkiye
TM Turkmenistan
TC Turks & Caicos Islands
TV Tuvalu
UM U.S. Outlying Islands
VI U.S. Virgin Islands
UG Uganda
UA Ukraine
AE United Arab Emirates
GB United Kingdom
US United States
UY Uruguay
UZ Uzbekistan
VU Vanuatu
VA Vatican City
VE Venezuela
VN Vietnam
WF Wallis & Futuna
EH Western Sahara
YE Yemen
ZM Zambia
ZW Zimbabwe`);

/** The fifty states and the District of Columbia. */
export const US_STATES: readonly Place[] = pairs(
  `AL Alabama
AK Alaska
AZ Arizona
AR Arkansas
CA California
CO Colorado
CT Connecticut
DE Delaware
DC District of Columbia
FL Florida
GA Georgia
HI Hawaii
ID Idaho
IL Illinois
IN Indiana
IA Iowa
KS Kansas
KY Kentucky
LA Louisiana
ME Maine
MD Maryland
MA Massachusetts
MI Michigan
MN Minnesota
MS Mississippi
MO Missouri
MT Montana
NE Nebraska
NV Nevada
NH New Hampshire
NJ New Jersey
NM New Mexico
NY New York
NC North Carolina
ND North Dakota
OH Ohio
OK Oklahoma
OR Oregon
PA Pennsylvania
RI Rhode Island
SC South Carolina
SD South Dakota
TN Tennessee
TX Texas
UT Utah
VT Vermont
VA Virginia
WA Washington
WV West Virginia
WI Wisconsin
WY Wyoming`,
  "US-",
);

/** Shown above the A-to-Z list, where most people here will look first. */
export const COUNTRIES_FIRST: readonly string[] = ["US"];

/* Other names people look a place up by. Only for searching: the list
   itself shows one name each. */
const ALSO: Record<string, string> = {
  AE: "UAE Emirates",
  AG: "Antigua and Barbuda",
  AX: "Aland",
  BA: "Bosnia and Herzegovina",
  BL: "Saint Barthelemy",
  BN: "Brunei Darussalam",
  CD: "DRC Democratic Republic of the Congo Zaire",
  CG: "Republic of the Congo",
  CI: "Ivory Coast",
  CV: "Cabo Verde",
  CW: "Curacao",
  CZ: "Czech Republic",
  FM: "Federated States of Micronesia",
  GB: "UK Great Britain England Scotland Wales Northern Ireland",
  HK: "Hong Kong SAR China",
  KN: "Saint Kitts and Nevis",
  KP: "DPRK",
  KR: "Republic of Korea",
  LA: "Lao",
  LC: "Saint Lucia",
  MF: "Saint Martin",
  MK: "Macedonia",
  MM: "Burma",
  MO: "Macau",
  NL: "Holland",
  PM: "Saint Pierre and Miquelon",
  PS: "Palestinian Territories West Bank Gaza",
  RE: "Reunion",
  RU: "Russian Federation",
  SH: "Saint Helena",
  ST: "Sao Tome and Principe",
  SZ: "Swaziland",
  TL: "East Timor",
  TR: "Turkey",
  TT: "Trinidad and Tobago",
  US: "USA America",
  VA: "Holy See",
  VC: "Saint Vincent and the Grenadines",
  "US-DC": "Washington DC",
};

const countryNames = new Map(COUNTRIES);
const stateNames = new Map(US_STATES);

export function countryName(code: string | null | undefined): string | null {
  return (code && countryNames.get(code)) || null;
}

export function stateName(code: string | null | undefined): string | null {
  return (code && stateNames.get(code)) || null;
}

/** Only the United States is asked for a state. */
export function needsState(country: string | null | undefined): boolean {
  return country === "US";
}

/** "California, United States", "Canada", or null when the country isn't one we know. */
export function placeLabel(country: string | null | undefined, region: string | null | undefined): string | null {
  const c = countryName(country);
  if (!c) return null;
  const s = needsState(country) ? stateName(region) : null;
  return s ? `${s}, ${c}` : c;
}

/** Lower case, accents off, "&" as "and": how a search compares names. */
function plain(text: string): string {
  let t = text.toLowerCase().replace(/&/g, "and");
  try {
    t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    /* an engine without normalize: accents stay */
  }
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

/** The places that match what was typed, best first: the code or another
    name exactly ("ca", "uk"), then names that start with it, then names
    with a word that does, then anything that contains it. All of them,
    in their own order, for an empty search. */
export function searchPlaces(places: readonly Place[], query: string): Place[] {
  const q = plain(query);
  if (!q) return [...places];
  const found: Array<[rank: number, place: Place]> = [];
  for (const place of places) {
    const [code, name] = place;
    const short = code.slice(code.indexOf("-") + 1).toLowerCase();
    const n = plain(name);
    const also = plain(ALSO[code] ?? "");
    const rank =
      short === q || also.split(" ").includes(q) ? 0
      : n.startsWith(q) ? 1
      : n.includes(" " + q) ? 2
      : n.includes(q) || also.includes(q) ? 3
      : -1;
    if (rank >= 0) found.push([rank, place]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, place]) => place);
}
