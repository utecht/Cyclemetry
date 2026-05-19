import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import './globals.css'

export const metadata = {
  metadataBase: new URL('https://walkersutton.github.io/cyclemetry'),
  title: {
    template: '%s — Cyclemetry',
    default: 'Cyclemetry — Cycling Telemetry Video Overlays',
  },
  description:
    'Create stunning cycling telemetry video overlays from GPX data. Visualize speed, power, heart rate, elevation, cadence, and more.',
  keywords: [
    'cycling telemetry overlay',
    'GPX video overlay',
    'cycling video data overlay',
    'Garmin VIRB alternative',
    'GoPro telemetry extractor alternative',
    'bike data overlay software',
    'cycling YouTube overlay tool',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Cyclemetry',
  },
}

const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: '#dc143c', fontSize: '1.1em', lineHeight: 1 }}>■</span>
        Cyclemetry
      </span>
    }
    projectLink="https://github.com/walkersutton/cyclemetry"
  />
)

const footer = (
  <Footer>
    <span style={{ color: '#a1a1aa', fontSize: '0.875rem' }}>
      MIT {new Date().getFullYear()} ©{' '}
      <a
        href="https://github.com/walkersutton"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#fafafa' }}
      >
        Walker Sutton
      </a>
    </span>
  </Footer>
)

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="icon" href="/cyclemetry/favicon.ico" />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/walkersutton/cyclemetry/blob/main/website"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          editLink="Edit this page on GitHub"
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
