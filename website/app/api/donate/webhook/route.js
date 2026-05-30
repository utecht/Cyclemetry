import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

export async function POST(request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const payload = await request.text()
  const sig = request.headers.get('stripe-signature')

  let event
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    )
  } catch (err) {
    console.error('[donate/webhook] signature error:', err.message)
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  if (
    event.type === 'checkout.session.completed' &&
    event.data.object.metadata?.fund === 'cyclemetry-apple-developer'
  ) {
    revalidateTag('fund-total')
  }

  return NextResponse.json({ ok: true })
}
