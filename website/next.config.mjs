import nextra from 'nextra'

const withNextra = nextra({
  // Content directory where MDX files live
})

export default withNextra({
  // Served from the root of https://cyclemetry.walkersutton.com/
  trailingSlash: true,
})
