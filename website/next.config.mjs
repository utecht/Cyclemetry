import nextra from 'nextra'

const withNextra = nextra({
  // Content directory where MDX files live
})

export default withNextra({
  output: 'export',
  // Served from the root of https://cyclemetry.walkersutton.com/
  images: {
    unoptimized: true,
  },
  // Required for static export with next-themes
  trailingSlash: true,
})
