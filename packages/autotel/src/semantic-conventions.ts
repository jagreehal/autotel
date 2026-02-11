import {
  HTTPAttributes,
  ServiceAttributes,
  URLAttributes,
} from './attributes/registry';

export { HTTPAttributes, ServiceAttributes, URLAttributes };

export function httpRequestHeaderAttribute(name: string): string {
  return `http.request.header.${name.toLowerCase()}`;
}

export function httpResponseHeaderAttribute(name: string): string {
  return `http.response.header.${name.toLowerCase()}`;
}
