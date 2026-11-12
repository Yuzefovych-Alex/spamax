const API_BASE_URL = 'https://lolibox.netlify.app';

export function apiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}
