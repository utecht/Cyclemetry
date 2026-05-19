import nextra from 'nextra'

const withNextra = nextra({
  // Content directory where MDX files live
})

export default withNextra({
  output: 'export',
  // Served at https://walkersutton.github.io/cyclemetry/
  basePath: '/cyclemetry',
  images: {
    unoptimized: true,
  },
  // Required for static export with next-themes
  trailingSlash: true,
})
