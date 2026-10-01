const VALID_SUFFIX_AFTER_DOMAIN = ["#", "/", ".", "?", ":"];
const DOMAIN_PREFIX = ".";
const DOMAINS = new Set([
  "io",
  "com",
  "space",
  "org",
  "gov",
  "net",
  "me",
  "cc",
  "us",
  "co",
  "ru",
  "nz",
  "dev",
  "ms",
  "rs",
  "nl",
  "it",
  "edu",
  "ai",
  "app",
  "site",
  "website",
  "ca",
  "microsoft",
  "de",
  "tv",
  "be",
  "blog",
  "cloud",
  "xyz",
  "info",
]);

const PROTOCOL_REGEX = /^(https?|ftp|file):\/\//i;
const IP_OR_LOCALHOST_REGEX =
  /^localhost(:\d+)(\/.*)?$|^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/i;

export function getUrl(string) {
  if (!string) return;
  const trimmed = string.trim();

  if (trimmed.includes(" ")) return;

  if (PROTOCOL_REGEX.test(trimmed)) {
    return trimmed;
  }

  if (IP_OR_LOCALHOST_REGEX.test(trimmed)) {
    return "http://" + trimmed;
  }

  const dotIndex = trimmed.indexOf(".");
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return;

  for (const domain of DOMAINS) {
    const d = DOMAIN_PREFIX + domain;

    if (
      trimmed.endsWith(d) ||
      VALID_SUFFIX_AFTER_DOMAIN.some((s) => trimmed.includes(d + s))
    ) {
      return "https://" + trimmed;
    }
  }
}
