import templates from '../content/templates.json'

function inspiration(template) {
  if (!template.inspiration) return null
  if (typeof template.inspiration === 'string') {
    return { label: 'Inspiration', url: template.inspiration }
  }
  return template.inspiration.url ? template.inspiration : null
}

export function Templates() {
  return (
    <div className="showcase-page showcase-page-wide">
      <div className="showcase-hero">
        <div className="showcase-hero-kicker">COMMUNITY</div>
        <h1 className="showcase-hero-title">Browse Overlays</h1>
        <p className="showcase-hero-desc">
          Discover beautiful layouts created by the Cyclemetry community. Browse, customize, and install these templates directly from the in-app browser via <strong>Templates → Browse Community Templates</strong>.
        </p>
      </div>

      <div className="showcase-grid">
        {templates.map((template) => {
          const credit = inspiration(template)
          return (
            <div key={template.name} className="showcase-card">
              <div className="showcase-card-video">
                <a href={template.githubUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${template.displayName} template`}>
                  <img
                    src={template.previewUrl}
                    alt={`${template.displayName} template preview`}
                    loading="lazy"
                  />
                </a>
              </div>
              <div className="showcase-card-info">
                <div className="showcase-card-title">{template.displayName}</div>
                <div className="showcase-card-actions">
                  <a className="showcase-button showcase-button-sm showcase-button-primary" href={template.githubUrl} target="_blank" rel="noopener noreferrer">
                    View Folder
                  </a>
                  <a className="showcase-button showcase-button-sm" href={template.jsonUrl} target="_blank" rel="noopener noreferrer">
                    JSON Schema
                  </a>
                  {credit ? (
                    <a className="showcase-button showcase-button-sm" href={credit.url} target="_blank" rel="noopener noreferrer">
                      {credit.label ?? 'Inspiration'}
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="showcase-submit-panel">
        <div>
          <h2>Submit a template</h2>
          <p>Created a customized telemetry overlay you love? Share it with the community.</p>
        </div>
        <div className="showcase-submit-actions">
          <a className="showcase-button showcase-button-primary" href="https://github.com/walkersutton/cyclemetry/tree/main/templates" target="_blank" rel="noopener noreferrer">
            Submit your template
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </a>
        </div>
      </div>
    </div>
  )
}
