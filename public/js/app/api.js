// JSON fetch for the owner panel. A 401 sends the user to the login screen; other errors throw
// with the server's Persian message so callers can show it.
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.assign('/panel');
    throw new Error('ابتدا وارد شوید');
  }
  if (!res.ok) throw new Error(data.error || 'خطایی رخ داد. دوباره امتحان کنید.');
  return data;
}

export const get = (path) => api('GET', path);
