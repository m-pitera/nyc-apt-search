import { canonicalizeStreetEasyUrl, isStreetEasyHost } from "../shared/schema";

type Case = { input: string; expected: string; label: string };

const cases: Case[] = [
  {
    label: "www host is lowercased and stripped",
    input: "https://WWW.StreetEasy.com/rental/1234567",
    expected: "https://streeteasy.com/rental/1234567",
  },
  {
    label: "trailing slash is trimmed",
    input: "https://streeteasy.com/rental/1234567/",
    expected: "https://streeteasy.com/rental/1234567",
  },
  {
    label: "query params and fragments are stripped",
    input: "https://streeteasy.com/rental/1234567?utm_source=x&foo=bar#photos",
    expected: "https://streeteasy.com/rental/1234567",
  },
  {
    label: "http is upgraded to https",
    input: "http://streeteasy.com/rental/1234567",
    expected: "https://streeteasy.com/rental/1234567",
  },
  {
    label: "nested paths are preserved",
    input: "https://streeteasy.com/building/foo-bar/apt-3b",
    expected: "https://streeteasy.com/building/foo-bar/apt-3b",
  },
  {
    label: "mixed case path is preserved as-is",
    input: "https://streeteasy.com/Rental/ABC",
    expected: "https://streeteasy.com/Rental/ABC",
  },
  {
    label: "non-streeteasy host returns empty",
    input: "https://zillow.com/rental/1234567",
    expected: "",
  },
  {
    label: "invalid URL returns empty",
    input: "not-a-url",
    expected: "",
  },
  {
    label: "empty string returns empty",
    input: "",
    expected: "",
  },
  {
    label: "root path keeps single slash",
    input: "https://streeteasy.com/",
    expected: "https://streeteasy.com/",
  },
];

let failed = 0;
for (const { label, input, expected } of cases) {
  const actual = canonicalizeStreetEasyUrl(input);
  if (actual !== expected) {
    failed++;
    console.error(`FAIL: ${label}\n  input: ${JSON.stringify(input)}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok  ${label}`);
  }
}

const hostChecks: Array<[string, boolean]> = [
  ["streeteasy.com", true],
  ["www.streeteasy.com", true],
  ["WWW.STREETEASY.COM", true],
  ["blog.streeteasy.com", false],
  ["zillow.com", false],
];

for (const [host, expected] of hostChecks) {
  const actual = isStreetEasyHost(host);
  if (actual !== expected) {
    failed++;
    console.error(`FAIL: isStreetEasyHost(${host}) = ${actual}, expected ${expected}`);
  } else {
    console.log(`ok  isStreetEasyHost(${host}) = ${expected}`);
  }
}

const twoUrls = [
  "https://www.streeteasy.com/rental/1234567?utm=x",
  "https://streeteasy.com/rental/1234567/",
];
const canonicalSet = new Set(twoUrls.map(canonicalizeStreetEasyUrl));
if (canonicalSet.size !== 1) {
  failed++;
  console.error(`FAIL: duplicate-detection roundtrip produced ${canonicalSet.size} canonicals, expected 1`);
} else {
  console.log(`ok  both variants canonicalize to a single value`);
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed`);
