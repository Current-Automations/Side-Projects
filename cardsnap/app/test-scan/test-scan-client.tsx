'use client';

/**
 * Client half of the dev test harness. Reads an image file as a base64 data URI
 * and POSTs it (with a userId) to /api/scan, then dumps the raw JSON response.
 */

import { useState } from 'react';

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function TestScanClient() {
  const [userId, setUserId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    if (!file) {
      setError('Choose an image first.');
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    setStatus(null);

    try {
      const image = await readAsDataUri(file);
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, userId }),
      });
      setStatus(res.status);
      const json = await res.json();
      setResponse(JSON.stringify(json, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.4rem' }}>Scan endpoint test harness</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Dev-only. POSTs an image to <code>/api/scan</code> and shows the raw response.
      </p>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>User ID (UUID)</span>
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          style={{ width: '100%', padding: 8, fontFamily: 'monospace' }}
        />
      </label>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Card image</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
      </label>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="preview" style={{ maxWidth: 240, marginTop: '1rem', display: 'block' }} />
      )}

      <button
        onClick={handleScan}
        disabled={loading || !file}
        style={{ marginTop: '1rem', padding: '8px 16px', cursor: loading ? 'wait' : 'pointer' }}
      >
        {loading ? 'Scanning…' : 'Scan'}
      </button>

      {error && <p style={{ color: '#b00', marginTop: '1rem' }}>{error}</p>}

      {response && (
        <>
          <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>
            Response{status !== null ? ` (HTTP ${status})` : ''}
          </h2>
          <pre
            style={{
              background: '#0d1117',
              color: '#c9d1d9',
              padding: '1rem',
              borderRadius: 6,
              overflowX: 'auto',
              fontSize: '0.8rem',
            }}
          >
            {response}
          </pre>
        </>
      )}
    </main>
  );
}
