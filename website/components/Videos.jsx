import videos from '../content/videos/videos.json'

const videoGrid = videos.map((video) => (
  <div key={video.id} className="showcase-card">
    <div className="showcase-card-video">
      <a href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${video.title} by ${video.author}`}>
        <img
          src={`https://img.youtube.com/vi/${video.id}/mqdefault.jpg`}
          alt={`${video.title} by ${video.author}`}
          loading="lazy"
        />
        <div className="showcase-play-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </div>
      </a>
    </div>
    <div className="showcase-card-info">
      <div className="showcase-card-title">{video.title}</div>
      <div className="showcase-card-author">by {video.author}</div>
    </div>
  </div>
))

export function Videos() {
  return (
    <div className="showcase-page showcase-page-wide">
      <div className="showcase-hero">
        <div className="showcase-hero-kicker">VIDEOS</div>
        <h1 className="showcase-hero-title">Made With Cyclemetry</h1>
        <p className="showcase-hero-desc">
          See what cyclists around the world are creating with Cyclemetry. Every video here is made with Cyclemetry — telemetry overlays synced to ride footage.
        </p>
      </div>

      <div className="showcase-grid">{videoGrid}</div>

      <div className="showcase-submit-panel">
        <div>
          <h2>Share your ride</h2>
          <p>Made a video with Cyclemetry? Send it in and we can feature it here.</p>
        </div>
        <div className="showcase-submit-actions">
          <a className="showcase-button showcase-button-primary" href="/videos/submit">
            Submit your video
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </a>
          <a className="showcase-button" href="https://github.com/walkersutton/cyclemetry/blob/main/website/content/videos/videos.json" target="_blank" rel="noopener noreferrer">
            View JSON
          </a>
        </div>
      </div>

      <div className="showcase-callout">
        <div className="showcase-callout-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-3" /><path d="M12 8h.01" /></svg>
        </div>
        <div className="showcase-callout-text">
          <strong>Want to add your video?</strong> It only takes a minute — <a href="/videos/submit">see how to submit yours</a>.
        </div>
      </div>
    </div>
  )
}

export function SubmitVideo() {
  return (
    <div className="showcase-page showcase-page-narrow">
      <div className="showcase-hero">
        <div className="showcase-hero-kicker">SUBMIT</div>
        <h1 className="showcase-hero-title">Submit Your Video</h1>
        <p className="showcase-hero-desc">
          Add your ride video to the Cyclemetry community. It takes about a minute.
        </p>
      </div>

      <div className="showcase-content">
        <h2>How to Submit</h2>

        <ol className="showcase-steps">
          <li>
            <strong>Record your ride</strong> with Cyclemetry and upload the video to YouTube
          </li>
          <li>
            <strong>Open the video list</strong> — click the button below to view the video data file
          </li>
          <li>
            <strong>Add your video</strong> — copy one of the existing entries and fill in your details:
          </li>
        </ol>

        <pre className="showcase-code-block">
          <code>{`{
  "id": "YOUR_VIDEO_ID",
  "title": "Your Ride Title",
  "author": "Your Name",
  "url": "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
}`}</code>
        </pre>

        <div className="showcase-submit-actions">
          <a className="showcase-button showcase-button-primary" href="https://github.com/walkersutton/cyclemetry/blob/main/website/content/videos/videos.json" target="_blank" rel="noopener noreferrer">
            Open video list on GitHub
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </a>
        </div>

        <h2>What You Need</h2>
        <ul className="showcase-list">
          <li>A YouTube link to your Cyclemetry-made video</li>
          <li>The video ID (the part after <code>v=</code> in the URL)</li>
          <li>A title and author name</li>
        </ul>

        <h2>Why a PR?</h2>
        <p>
          The video list is a small JSON file in the repo. A PR is the simplest way for community members to contribute without needing write access. The maintainer reviews and merges — it&apos;s fast and transparent.
        </p>

        <div className="showcase-callout">
          <div className="showcase-callout-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-3" /><path d="M12 8h.01" /></svg>
          </div>
          <div className="showcase-callout-text">
            <strong>Questions?</strong> Open a <a href="https://github.com/walkersutton/cyclemetry/issues">GitHub issue</a> and we&apos;ll help you get your video featured.
          </div>
        </div>
      </div>
    </div>
  )
}
