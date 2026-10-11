# Square

Settle up shared payments between Pieter, Luke, Johnny and James.
Add a payment in one go: amount, how it's split, who paid, what it was for.

## Setup (one time)

1. **Database** — create a free project at [supabase.com](https://supabase.com), open
   *SQL Editor*, paste `supabase/setup.sql` and run it.
2. **Keys** — in Supabase go to *Project Settings → API* and copy the Project URL and
   the `anon` public key into `config.js`.
3. **Hosting** — in this repo go to *Settings → Pages*, set Source to
   *Deploy from a branch*, branch `main`, folder `/ (root)`. The app appears at
   `https://<your-username>.github.io/square/`.
4. On your phone, open the link and *Add to Home Screen*.

Until step 2 is done the app runs in demo mode, saving to each phone only.

## How the maths works

- Amounts are stored in pence; each payment's split always adds up to the exact total.
- Each person's balance = what they paid − their share of everything.
- *Settle up* suggests the fewest payments to clear all balances. Marking one as paid
  records it as a "settle" payment, so history stays complete.
