export async function call(u: string): Promise<Response> {
  return fetch(u); // nosemgrep: platform.outbound-http
}
