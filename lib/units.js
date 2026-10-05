/*
 * Lightning Search Launcher, unit conversion
 *
 * Copyright (C) 2026 Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

const RESULT_PRECISION = 12;

// e.g. "10 km to mi",
// "cup to qt", "5 ft in in" or "100 km/h -> mph".
const CONVERT_RE =
  /^(?:convert\s+)?([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)?\s*([a-zµμ°²³0-9/ ]+?)\s+(?:to|in|into|as|->|→)\s+([a-zµμ°²³0-9/ ]+?)\s*$/i;

const UNITS = {
  m: {
    category: "length",
    factor: 1,
    aliases: ["meter", "meters", "metre", "metres"],
  },
  km: {
    category: "length",
    factor: 1000,
    aliases: ["kilometer", "kilometers", "kilometre", "kilometres"],
  },
  cm: {
    category: "length",
    factor: 0.01,
    aliases: ["centimeter", "centimeters", "centimetre", "centimetres"],
  },
  mm: {
    category: "length",
    factor: 0.001,
    aliases: ["millimeter", "millimeters", "millimetre", "millimetres"],
  },
  um: {
    category: "length",
    factor: 1e-6,
    aliases: ["micrometer", "micrometers", "micron", "microns"],
  },
  nm: {
    category: "length",
    factor: 1e-9,
    aliases: ["nanometer", "nanometers"],
  },
  mi: { category: "length", factor: 1609.344, aliases: ["mile", "miles"] },
  yd: { category: "length", factor: 0.9144, aliases: ["yard", "yards"] },
  ft: { category: "length", factor: 0.3048, aliases: ["foot", "feet"] },
  in: { category: "length", factor: 0.0254, aliases: ["inch", "inches"] },
  nmi: {
    category: "length",
    factor: 1852,
    aliases: ["nautical mile", "nautical miles"],
  },

  // base: kilogram
  kg: { category: "mass", factor: 1, aliases: ["kilogram", "kilograms"] },
  g: { category: "mass", factor: 0.001, aliases: ["gram", "grams"] },
  mg: { category: "mass", factor: 1e-6, aliases: ["milligram", "milligrams"] },
  t: {
    category: "mass",
    factor: 1000,
    aliases: ["tonne", "tonnes", "metric ton", "metric tons"],
  },
  lb: {
    category: "mass",
    factor: 0.45359237,
    aliases: ["pound", "pounds", "lbs"],
  },
  oz: {
    category: "mass",
    factor: 0.028349523125,
    aliases: ["ounce", "ounces"],
  },
  st: { category: "mass", factor: 6.35029318, aliases: ["stone", "stones"] },

  // base: liter
  l: {
    category: "volume",
    factor: 1,
    aliases: ["liter", "liters", "litre", "litres"],
  },
  ml: {
    category: "volume",
    factor: 0.001,
    aliases: ["milliliter", "milliliters", "millilitre", "millilitres"],
  },
  cl: {
    category: "volume",
    factor: 0.01,
    aliases: ["centiliter", "centiliters", "centilitre", "centilitres"],
  },
  cup: {
    category: "volume",
    factor: 0.2365882365,
    aliases: ["cups"],
    singular: "cup",
    plural: "cups",
  },
  pt: { category: "volume", factor: 0.473176473, aliases: ["pint", "pints"] },
  qt: { category: "volume", factor: 0.946352946, aliases: ["quart", "quarts"] },
  gal: {
    category: "volume",
    factor: 3.785411784,
    aliases: ["gallon", "gallons"],
  },
  "fl oz": {
    category: "volume",
    factor: 0.0295735295625,
    aliases: ["floz", "fluid ounce", "fluid ounces"],
  },
  tbsp: {
    category: "volume",
    factor: 0.01478676478125,
    aliases: ["tablespoon", "tablespoons"],
  },
  tsp: {
    category: "volume",
    factor: 0.00492892159375,
    aliases: ["teaspoon", "teaspoons"],
  },
  m3: {
    category: "volume",
    factor: 1000,
    aliases: ["cubic meter", "cubic meters", "cubic metre", "cubic metres"],
    label: "m³",
  },

  // base: second
  s: {
    category: "time",
    factor: 1,
    aliases: ["sec", "secs", "second", "seconds"],
  },
  ms: {
    category: "time",
    factor: 0.001,
    aliases: ["millisecond", "milliseconds"],
  },
  min: { category: "time", factor: 60, aliases: ["minute", "minutes", "mins"] },
  h: {
    category: "time",
    factor: 3600,
    aliases: ["hr", "hrs", "hour", "hours"],
  },
  day: {
    category: "time",
    factor: 86400,
    aliases: ["days"],
    singular: "day",
    plural: "days",
  },
  week: {
    category: "time",
    factor: 604800,
    aliases: ["weeks", "wk", "wks"],
    singular: "week",
    plural: "weeks",
  },
  year: {
    category: "time",
    factor: 31557600,
    aliases: ["years", "yr", "yrs"],
    singular: "year",
    plural: "years",
  },

  // base: square meter
  m2: {
    category: "area",
    factor: 1,
    aliases: [
      "sq m",
      "square meter",
      "square meters",
      "square metre",
      "square metres",
    ],
    label: "m²",
  },
  km2: {
    category: "area",
    factor: 1e6,
    aliases: ["sq km", "square kilometer", "square kilometers"],
    label: "km²",
  },
  cm2: {
    category: "area",
    factor: 1e-4,
    aliases: ["sq cm", "square centimeter", "square centimeters"],
    label: "cm²",
  },
  ft2: {
    category: "area",
    factor: 0.09290304,
    aliases: ["sq ft", "square foot", "square feet"],
    label: "ft²",
  },
  in2: {
    category: "area",
    factor: 0.00064516,
    aliases: ["sq in", "square inch", "square inches"],
    label: "in²",
  },
  yd2: {
    category: "area",
    factor: 0.83612736,
    aliases: ["sq yd", "square yard", "square yards"],
    label: "yd²",
  },
  acre: {
    category: "area",
    factor: 4046.8564224,
    aliases: ["acres"],
    singular: "acre",
    plural: "acres",
  },
  ha: { category: "area", factor: 10000, aliases: ["hectare", "hectares"] },

  // base: meter per second
  "m/s": {
    category: "speed",
    factor: 1,
    aliases: ["mps", "meter per second", "meters per second"],
  },
  "km/h": {
    category: "speed",
    factor: 1 / 3.6,
    aliases: [
      "kmh",
      "kph",
      "km per hour",
      "kilometer per hour",
      "kilometers per hour",
    ],
  },
  mph: {
    category: "speed",
    factor: 0.44704,
    aliases: ["mi/h", "mile per hour", "miles per hour"],
  },
  knot: {
    category: "speed",
    factor: 1852 / 3600,
    aliases: ["knots", "kn"],
    singular: "knot",
    plural: "knots",
  },
  "ft/s": {
    category: "speed",
    factor: 0.3048,
    aliases: ["fps", "feet per second", "foot per second"],
  },

  // base: byte
  byte: {
    category: "data",
    factor: 1,
    aliases: ["bytes"],
    singular: "byte",
    plural: "bytes",
  },
  kb: { category: "data", factor: 1000, aliases: ["kilobyte", "kilobytes"] },
  mb: { category: "data", factor: 1e6, aliases: ["megabyte", "megabytes"] },
  gb: { category: "data", factor: 1e9, aliases: ["gigabyte", "gigabytes"] },
  tb: { category: "data", factor: 1e12, aliases: ["terabyte", "terabytes"] },
  kib: { category: "data", factor: 1024, aliases: ["kibibyte", "kibibytes"] },
  mib: {
    category: "data",
    factor: 1024 ** 2,
    aliases: ["mebibyte", "mebibytes"],
  },
  gib: {
    category: "data",
    factor: 1024 ** 3,
    aliases: ["gibibyte", "gibibytes"],
  },
  tib: {
    category: "data",
    factor: 1024 ** 4,
    aliases: ["tebibyte", "tebibytes"],
  },

  // base: degree Celsius
  c: {
    category: "temperature",
    aliases: ["celsius", "centigrade", "degree celsius", "degrees celsius"],
    label: "°C",
  },
  f: {
    category: "temperature",
    aliases: ["fahrenheit", "degree fahrenheit", "degrees fahrenheit"],
    label: "°F",
  },
  k: {
    category: "temperature",
    aliases: ["kelvin", "degrees kelvin"],
    label: "K",
  },
};

const UNIT_INDEX = new Map();
for (const [canonical, definition] of Object.entries(UNITS)) {
  UNIT_INDEX.set(canonical, canonical);
  for (const alias of definition.aliases || [])
    UNIT_INDEX.set(alias, canonical);
}

const TO_CELSIUS = {
  c: (value) => value,
  f: (value) => ((value - 32) * 5) / 9,
  k: (value) => value - 273.15,
};

const FROM_CELSIUS = {
  c: (value) => value,
  f: (value) => (value * 9) / 5 + 32,
  k: (value) => value + 273.15,
};

function normalizeUnitText(text) {
  return text
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/[°º]/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function resolveUnit(text) {
  const key = normalizeUnitText(text);
  return key ? (UNIT_INDEX.get(key) ?? null) : null;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  return String(Number(value.toPrecision(RESULT_PRECISION)));
}

function displayUnit(unit, value) {
  const definition = UNITS[unit];
  if (definition.label) return definition.label;
  if (definition.singular)
    return value === 1 ? definition.singular : definition.plural;
  return unit;
}

export function convert(query) {
  if (typeof query !== "string") return null;

  const match = CONVERT_RE.exec(query.trim());
  if (!match) return null;

  const [, rawAmount, rawFrom, rawTo] = match;
  const amount = rawAmount === undefined ? 1 : Number(rawAmount);
  if (!Number.isFinite(amount)) return null;

  const from = resolveUnit(rawFrom);
  const to = resolveUnit(rawTo);
  if (!from || !to) return null;

  const fromDefinition = UNITS[from];
  const toDefinition = UNITS[to];
  if (fromDefinition.category !== toDefinition.category) return null;

  let value;
  if (from === to) {
    value = amount;
  } else if (fromDefinition.category === "temperature") {
    value = FROM_CELSIUS[to](TO_CELSIUS[from](amount));
  } else {
    value = (amount * fromDefinition.factor) / toDefinition.factor;
  }

  if (!Number.isFinite(value)) return null;
  const rounded = formatNumber(value);
  return {
    amount,
    from,
    to,
    value,
    text: `${rounded} ${displayUnit(to, value)}`,
  };
}
