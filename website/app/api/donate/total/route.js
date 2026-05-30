import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'

const fetchTotal = unstable_cache(
  async () => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    let raised = 0
    let supporters = 0

    for await (const session of stripe.checkout.sessions.list({ limit: 100 })) {
      if (
        session.payment_status === 'paid' &&
        session.metadata?.fund === 'cyclemetry-apple-developer'
      ) {
        raised += session.amount_total ?? 0
        supporters++
      }
    }

    return { raised: raised / 100, supporters }
  },
  ['cyclemetry-fund-total'],
  { revalidate: 600, tags: ['fund-total'] },
)

export async function GET() {
  try {
    const total = await fetchTotal()
    return NextResponse.json(total)
  } catch (err) {
    console.error('[donate/total]', err)
    return NextResponse.json({ raised: 0, supporters: 0 })
  }
}
