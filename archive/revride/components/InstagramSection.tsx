const placeholders = [
  { id: 1, label: "Oil change at your door" },
  { id: 2, label: "Brake job complete ✅" },
  { id: 3, label: "Ottawa mobile service" },
  { id: 4, label: "Diagnostics on-site" },
  { id: 5, label: "Right in your driveway" },
  { id: 6, label: "Follow @RevRide.Auto" },
];

const IGIcon = () => (
  <svg width="26" height="26" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
);

export default function InstagramSection() {
  return (
    <section
      id="instagram"
      className="section-spacing"
      style={{ background: "rgba(255,255,255,0.018)" }}
    >
      <div className="container-shell">
        {/* Header row */}
        <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="gold-tag">Follow Along</span>
            <h2
              className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-5xl"
              style={{ fontFamily: "var(--font-oswald), sans-serif" }}
            >
              @RevRide.Auto
            </h2>
            <p
              className="mt-2 text-sm"
              style={{ color: "var(--muted)" }}
            >
              Behind the wrench — real jobs, real results.
            </p>
          </div>
          <a
            href="https://www.instagram.com/RevRide.Auto"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline shrink-0 self-start sm:self-auto"
          >
            <IGIcon />
            Follow Us
          </a>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {placeholders.map((p) => (
            <a
              key={p.id}
              href="https://www.instagram.com/RevRide.Auto"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-square overflow-hidden rounded-xl"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
              }}
            >
              {/* Default state */}
              <div className="flex h-full flex-col items-center justify-center gap-3 p-3 text-center transition-opacity duration-200 group-hover:opacity-0">
                <span style={{ color: "var(--gold)", opacity: 0.55 }}>
                  <IGIcon />
                </span>
                <span
                  className="text-xs leading-snug"
                  style={{ color: "var(--muted)" }}
                >
                  {p.label}
                </span>
              </div>

              {/* Hover overlay */}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                style={{ background: "rgba(201,168,76,0.13)" }}
              >
                <span
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "var(--gold)" }}
                >
                  View
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
