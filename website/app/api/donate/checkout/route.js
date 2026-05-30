import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import fund from '../../../../content/fund.json'

export async function POST(request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  try {
    const { amountCents } = await request.json()

    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000) {
      return NextResponse.json(
        { error: 'Amount must be between $1 and $1,000.' },
        { status: 400 },
      )
    }

    const origin =
      request.headers.get('origin') ?? 'https://cyclemetry.walkersutton.com'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Cyclemetry Apple Developer Fund',
              description: `Covers the $${fund.goalPerYear}/year Apple Developer Program membership so the macOS build can be signed and notarized — no more terminal step on install.`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/fund/?donated=1`,
      cancel_url: `${origin}/fund/`,
      metadata: {
        fund: 'cyclemetry-apple-developer',
        year: String(fund.startYear),
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[donate/checkout]', err)
    return NextResponse.json(
      { error: 'Failed to create checkout session.' },
      { status: 500 },
    )
  }
}
