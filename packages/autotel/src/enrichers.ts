type Headers = Record<string, string | string[] | undefined>;

function get(headers: Headers, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

// --- User Agent ---

export interface UserAgentAttributes {
  'user_agent.raw': string;
  'user_agent.browser'?: string;
  'user_agent.os'?: string;
  'user_agent.device'?: string;
}

const BROWSER_RE = /(Firefox|OPR|Edg|Chrome|Safari|MSIE|Trident)[\s/]?([\d.]*)/;
const OS_RE =
  /(Windows NT|Mac OS X|Linux|Android|iPhone OS|iPad|CrOS)[\s]?([\d._]*)/;

function parseBrowser(ua: string): string | undefined {
  const m = BROWSER_RE.exec(ua);
  if (!m) return undefined;
  const name =
    m[1] === 'OPR'
      ? 'Opera'
      : m[1] === 'Edg'
        ? 'Edge'
        : m[1] === 'Trident'
          ? 'IE'
          : m[1];
  return m[2] ? `${name} ${m[2]}` : name;
}

function parseOS(ua: string): string | undefined {
  const m = OS_RE.exec(ua);
  if (!m) return undefined;
  const name =
    m[1] === 'iPhone OS'
      ? 'iOS'
      : m[1] === 'Windows NT'
        ? 'Windows'
        : m[1] === 'Mac OS X'
          ? 'macOS'
          : m[1];
  const ver = m[2]?.replaceAll('_', '.') || undefined;
  return ver ? `${name} ${ver}` : name;
}

function parseDevice(ua: string): string | undefined {
  if (/Mobi|Android.*Mobile|iPhone/.test(ua)) return 'mobile';
  if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) return 'tablet';
  if (/Bot|Crawler|Spider|Lighthouse/i.test(ua)) return 'bot';
  return 'desktop';
}

export function userAgent(headers: Headers): UserAgentAttributes | undefined {
  const raw = get(headers, 'user-agent');
  if (!raw) return undefined;

  const attrs: UserAgentAttributes = { 'user_agent.raw': raw };
  const browser = parseBrowser(raw);
  if (browser) attrs['user_agent.browser'] = browser;
  const os = parseOS(raw);
  if (os) attrs['user_agent.os'] = os;
  const device = parseDevice(raw);
  if (device) attrs['user_agent.device'] = device;

  return attrs;
}

// --- Geo ---

export interface GeoAttributes {
  'geo.country'?: string;
  'geo.region'?: string;
  'geo.city'?: string;
  'geo.latitude'?: string;
  'geo.longitude'?: string;
}

export function geo(headers: Headers): GeoAttributes | undefined {
  const country =
    get(headers, 'x-vercel-ip-country') ?? get(headers, 'cf-ipcountry');
  const region = get(headers, 'x-vercel-ip-country-region');
  const city = get(headers, 'x-vercel-ip-city');
  const latitude = get(headers, 'x-vercel-ip-latitude');
  const longitude = get(headers, 'x-vercel-ip-longitude');

  if (!country && !region && !city && !latitude && !longitude) return undefined;

  const attrs: GeoAttributes = {};
  if (country) attrs['geo.country'] = country;
  if (region) attrs['geo.region'] = region;
  if (city) {
    try {
      attrs['geo.city'] = decodeURIComponent(city);
    } catch {
      attrs['geo.city'] = city;
    }
  }
  if (latitude) attrs['geo.latitude'] = latitude;
  if (longitude) attrs['geo.longitude'] = longitude;

  return attrs;
}

// --- Request Size ---

export interface RequestSizeAttributes {
  'http.request.body.size'?: number;
  'http.response.body.size'?: number;
}

const DIGITS_RE = /^\d+$/;

function parseContentLength(value: string | undefined): number | undefined {
  if (!value || !DIGITS_RE.test(value)) return undefined;
  return Number(value);
}

export function requestSize(
  requestHeaders: Headers,
  responseHeaders?: Headers,
): RequestSizeAttributes | undefined {
  const reqLen = get(requestHeaders, 'content-length');
  const resLen = responseHeaders
    ? get(responseHeaders, 'content-length')
    : undefined;

  if (!reqLen && !resLen) return undefined;

  const attrs: RequestSizeAttributes = {};
  const reqBytes = parseContentLength(reqLen);
  if (reqBytes !== undefined) attrs['http.request.body.size'] = reqBytes;
  const resBytes = parseContentLength(resLen);
  if (resBytes !== undefined) attrs['http.response.body.size'] = resBytes;

  return Object.keys(attrs).length > 0 ? attrs : undefined;
}
