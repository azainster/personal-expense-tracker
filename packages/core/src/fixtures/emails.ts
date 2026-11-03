import type { SampleEmail } from './types.js';

/** Hand-labelled corpus. Bank alerts, merchant receipts, duplicates, and the noise that must be rejected. */
export const SAMPLE_EMAILS: SampleEmail[] = [
  // ── Bank alerts (L0 templates) ──────────────────────────────────────────────
  {
    id: 'hdfc-upi-swiggy',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'You have done a UPI txn. Check details!',
    daysAgo: 2,
    text: `Dear Customer,

Rs.450.00 has been debited from account **1234 to VPA swiggy@icici on {{d-m-y2}}.
Your UPI transaction reference number is 412345678901.
Avl Bal: Rs.1,23,456.78

If you did not authorise this transaction, please report immediately.

Warm Regards,
HDFC Bank`,
    expected: { status: 'parsed', amountMinor: 45000, currency: 'INR', merchantNormalized: 'swiggy', categoryKey: 'food_dining', extractionMethod: 'template', accountLast4: '1234', sourceKey: 'hdfc_bank', referenceId: '412345678901' },
  },
  {
    id: 'hdfc-card-amazon',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'Alert: Update on your HDFC Bank Credit Card',
    daysAgo: 4,
    text: `Dear Card Member,

Rs 2,499.00 spent on your HDFC Bank Credit Card xx5512 at POS 4023XXXX5512 AMAZON RETAIL*MK1 BANGALORE IN on {{d-m-y4}}.
Available Credit Limit: Rs 1,47,501.00
Total Credit Limit: Rs 1,50,000.00

Not you? Call 18002586161.`,
    expected: { status: 'parsed', amountMinor: 249900, currency: 'INR', merchantNormalized: 'amazon', categoryKey: 'shopping', extractionMethod: 'template', accountLast4: '5512', sourceKey: 'hdfc_bank' },
  },
  {
    id: 'hdfc-salary-credit',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'Amount credited to your account',
    daysAgo: 12,
    text: `Dear Customer,

Rs.85,000.00 is credited to your account **1234 from ACME TECHNOLOGIES PVT LTD SALARY on {{d-m-y2}}.
Avl Bal: Rs.2,08,456.78`,
    expected: { status: 'parsed', amountMinor: 8500000, currency: 'INR', merchantNormalized: 'acme', categoryKey: 'income', isCredit: true, extractionMethod: 'template' },
  },
  {
    id: 'icici-card-coffee',
    from: 'ICICI Bank <credit_cards@icicibank.com>',
    subject: 'Transaction alert for your ICICI Bank Credit Card',
    daysAgo: 3,
    text: `Dear Customer,

INR 1,250.00 was spent using ICICI Bank Card XX9012 on {{d-Mon-y2}} at BLUE TOKAI COFFEE ROASTERS. Avl Lmt: INR 1,48,750.00.
To dispute, SMS BLOCK 9012 to 9215676766.`,
    expected: { status: 'parsed', amountMinor: 125000, currency: 'INR', merchantNormalized: 'blue tokai', categoryKey: 'chai', extractionMethod: 'template', accountLast4: '9012' },
  },
  {
    id: 'icici-self-transfer',
    from: 'ICICI Bank <noreply@icicibank.com>',
    subject: 'Debit alert for your ICICI Bank account',
    daysAgo: 6,
    text: `Dear Customer,

INR 10,000.00 has been debited from your A/c XX9012 on {{d-Mon-y2}} towards transfer to your own account ending 1234.
Available balance: INR 54,200.15`,
    expected: { status: 'parsed', amountMinor: 1000000, currency: 'INR', merchantNormalized: 'self transfer', categoryKey: 'transfers', isTransfer: true, extractionMethod: 'template' },
  },
  {
    id: 'sbi-card-fuel',
    from: 'SBI Card <sbicard@sbicard.com>',
    subject: 'Transaction alert on your SBI Card',
    daysAgo: 9,
    text: `Dear Cardholder,

Rs.3,200.00 spent on your SBI Card ending XX4477 at INDIAN OIL PETROL PUMP HSR on {{d-m-y2}}.
Available credit limit is Rs.96,800.00. Reward points earned: 320`,
    expected: { status: 'parsed', amountMinor: 320000, currency: 'INR', merchantNormalized: 'indian oil', categoryKey: 'transport', extractionMethod: 'template', accountLast4: '4477' },
  },
  {
    id: 'chase-groceries',
    from: 'Chase Alerts <no.reply.alerts@chase.com>',
    subject: 'Your Single Transaction Alert from Chase',
    daysAgo: 5,
    text: `You made a transaction with TRADER JOES #182.

A charge of $54.20 at TRADER JOES was made on {{Mon d, y4}}.
Account ending in (...4432)
Available balance: $3,182.44`,
    expected: { status: 'parsed', amountMinor: 5420, currency: 'USD', merchantNormalized: 'trader joes', categoryKey: 'groceries', extractionMethod: 'template' },
  },

  // ── Merchant receipts (L1 JSON-LD and L2 scoring) ───────────────────────────
  {
    id: 'amazon-order-confirm',
    from: 'Amazon.in <auto-confirm@amazon.in>',
    subject: 'Your Amazon.in order of Anker USB-C Hub',
    daysAgo: 4,
    html: `<html><head>
<script type="application/ld+json">
{"@context":"http://schema.org","@type":"Order","orderNumber":"402-8873321-4455102",
 "priceCurrency":"INR","price":"2499.00","orderDate":"{{iso}}",
 "merchant":{"@type":"Organization","name":"Amazon.in"},
 "acceptedOffer":{"@type":"Offer","itemOffered":{"@type":"Product","name":"Anker USB-C Hub"}}}
</script></head>
<body><h1>Your order has been placed</h1>
<table><tr><td>Item Subtotal:</td><td>INR 2,299.00</td></tr>
<tr><td>Shipping:</td><td>INR 0.00</td></tr>
<tr><td>GST:</td><td>INR 200.00</td></tr>
<tr><td><b>Order Total:</b></td><td><b>INR 2,499.00</b></td></tr></table>
<p>Delivering to Bengaluru 560102</p></body></html>`,
    // L0 runs before L1, so a sender with a template answers before the JSON-LD is read.
    // `flipkart-jsonld-order` below covers the L1 path with a sender that has no template.
    expected: { status: 'parsed', amountMinor: 249900, currency: 'INR', merchantNormalized: 'amazon', categoryKey: 'shopping', extractionMethod: 'template', duplicateOf: 'hdfc-card-amazon' },
  },
  {
    id: 'phonepe-swiggy-confirm',
    from: 'PhonePe <noreply@phonepe.com>',
    subject: 'Payment successful to Swiggy',
    daysAgo: 2,
    text: `Payment successful!

You paid ₹450.00 to Swiggy on {{d-m-y4}}.
Transaction ID: T2409031234567890
Paid via UPI - HDFC Bank ****1234

Thanks for using PhonePe.`,
    expected: { status: 'parsed', amountMinor: 45000, currency: 'INR', merchantNormalized: 'swiggy', categoryKey: 'food_dining', extractionMethod: 'regex', duplicateOf: 'hdfc-upi-swiggy' },
  },
  {
    id: 'uber-trip-receipt',
    from: 'Uber Receipts <receipts@uber.com>',
    subject: 'Your Thursday evening trip with Uber',
    daysAgo: 7,
    html: `<html><body>
<p>Thanks for riding, Alex</p>
<h2>Total ₹ 386.50</h2>
<table>
<tr><td>Trip fare</td><td>₹340.00</td></tr>
<tr><td>Booking fee</td><td>₹26.50</td></tr>
<tr><td>Promotion</td><td>-₹40.00</td></tr>
<tr><td><b>Total</b></td><td><b>₹386.50</b></td></tr>
</table>
<p>You saved ₹40.00 on this trip</p>
<p>Trip date {{d-m-y4}} · Payment: Visa ••••5512</p>
</body></html>`,
    expected: { status: 'parsed', amountMinor: 38650, currency: 'INR', merchantNormalized: 'uber', categoryKey: 'transport', extractionMethod: 'template' },
  },
  {
    id: 'swiggy-order-receipt',
    from: 'Swiggy <noreply@swiggy.in>',
    subject: 'Order delivered — here is your bill',
    daysAgo: 10,
    html: `<html><body>
<h3>Order #98213447 from Meghana Foods</h3>
<table>
<tr><td>Item Total</td><td>₹620.00</td></tr>
<tr><td>Delivery Fee</td><td>₹35.00</td></tr>
<tr><td>GST and Restaurant Charges</td><td>₹58.00</td></tr>
<tr><td>Discount Applied</td><td>-₹100.00</td></tr>
<tr><td><b>Grand Total</b></td><td><b>₹613.00</b></td></tr>
</table>
<p>Ordered on {{d-m-y4}}</p>
</body></html>`,
    expected: { status: 'parsed', amountMinor: 61300, currency: 'INR', merchantNormalized: 'swiggy', categoryKey: 'food_dining', extractionMethod: 'template' },
  },
  {
    id: 'zomato-order',
    from: 'Zomato <noreply@zomato.com>',
    subject: 'Your Zomato order receipt',
    daysAgo: 14,
    html: `<html><body><p>Order from Truffles, Koramangala</p>
<table><tr><td>Subtotal</td><td>₹840.00</td></tr>
<tr><td>Taxes</td><td>₹42.00</td></tr>
<tr><td><b>Total</b></td><td><b>₹882.00</b></td></tr></table>
<p>Placed {{d-m-y4}}</p></body></html>`,
    expected: { status: 'parsed', amountMinor: 88200, currency: 'INR', merchantNormalized: 'zomato', categoryKey: 'food_dining', extractionMethod: 'template' },
  },
  {
    id: 'apple-services-receipt',
    from: 'Apple <no_reply@email.apple.com>',
    subject: 'Your receipt from Apple',
    daysAgo: 8,
    html: `<html><body><p>APPLE RECEIPT</p>
<table><tr><td>iCloud+ 200GB Monthly</td><td>$2.99</td></tr>
<tr><td>Subtotal</td><td>$2.99</td></tr>
<tr><td>Tax</td><td>$0.00</td></tr>
<tr><td><b>TOTAL</b></td><td><b>$2.99</b></td></tr></table>
<p>Date: {{Mon d, y4}}</p></body></html>`,
    expected: { status: 'parsed', amountMinor: 299, currency: 'USD', merchantNormalized: 'apple', extractionMethod: 'template' },
  },
  {
    id: 'stripe-saas-receipt',
    from: 'Stripe <receipts@stripe.com>',
    subject: 'Your receipt from Linear',
    daysAgo: 11,
    html: `<html><body><h2>Receipt from Linear</h2>
<p>Amount paid $16.00</p>
<p>Date paid {{Mon d, y4}}</p>
<p>Payment method Visa - 5512</p></body></html>`,
    expected: { status: 'parsed', amountMinor: 1600, currency: 'USD', merchantNormalized: 'linear', extractionMethod: 'template' },
  },
  {
    id: 'amazon-refund',
    from: 'Amazon.in <order-update@amazon.in>',
    subject: 'Refund initiated for your return',
    daysAgo: 13,
    text: `Hello Alex,

A refund of INR 1,299.00 has been credited for your returned item (Order 402-1123344-9081221) on {{d-m-y4}}.
Refunds usually reach your account in 3-5 business days.`,
    expected: { status: 'parsed', amountMinor: 129900, currency: 'INR', merchantNormalized: 'amazon', isCredit: true, extractionMethod: 'regex' },
  },

  // ── Long-tail unknown senders (L2 workhorse) ─────────────────────────────────
  {
    id: 'bigbasket-order',
    from: 'BigBasket <noreply@bigbasket.com>',
    subject: 'Your bigbasket order BB-77213 is delivered',
    daysAgo: 6,
    text: `Hi Alex,

Your order has been delivered on {{d-m-y4}}.
Order Total: Rs. 3,842.50
You saved Rs. 412.00 on this order.
Payment mode: UPI`,
    expected: { status: 'parsed', amountMinor: 384250, currency: 'INR', merchantNormalized: 'bigbasket', categoryKey: 'groceries', extractionMethod: 'regex' },
  },
  {
    id: 'bescom-electricity',
    from: 'BESCOM <no-reply@bescom.co.in>',
    subject: 'Electricity bill payment received',
    daysAgo: 15,
    text: `Payment received.

We have received your payment of Rs. 2,145.00 towards BESCOM electricity bill for consumer number 1234567890 on {{d-m-y4}}.
Previous balance: Rs. 0.00`,
    expected: { status: 'parsed', amountMinor: 214500, currency: 'INR', merchantNormalized: 'bescom', categoryKey: 'bills', extractionMethod: 'regex' },
  },
  {
    id: 'airtel-recharge',
    from: 'Airtel <noreply@airtel.com>',
    subject: 'Recharge successful',
    daysAgo: 17,
    text: `Your Airtel prepaid recharge of Rs 399.00 was successful on {{d-m-y4}}.
Validity 28 days. Talktime balance: Rs 0.00`,
    expected: { status: 'parsed', amountMinor: 39900, currency: 'INR', merchantNormalized: 'airtel', categoryKey: 'bills', extractionMethod: 'regex' },
  },
  {
    id: 'netflix-subscription',
    from: 'Netflix <info@mailer.netflix.com>',
    subject: 'Your Netflix invoice',
    daysAgo: 16,
    html: `<html><body><p>Netflix</p>
<table><tr><td>Premium plan</td><td>₹649.00</td></tr>
<tr><td>Tax</td><td>₹0.00</td></tr>
<tr><td><b>Total charged</b></td><td><b>₹649.00</b></td></tr></table>
<p>Billed on {{d-m-y4}} to Visa ••5512</p></body></html>`,
    expected: { status: 'parsed', amountMinor: 64900, currency: 'INR', merchantNormalized: 'netflix', categoryKey: 'subscriptions', extractionMethod: 'regex' },
  },
  {
    id: 'bookmyshow-tickets',
    from: 'BookMyShow <tickets@bookmyshow.com>',
    subject: 'Booking confirmed — 2 tickets',
    daysAgo: 19,
    text: `Booking Confirmed!

PVR Forum Mall, Koramangala
2 tickets · {{d-m-y4}}
Amount paid: Rs. 940.00
Convenience fee: Rs. 88.00 (included)
Booking ID: BMS8821347`,
    expected: { status: 'parsed', amountMinor: 94000, currency: 'INR', merchantNormalized: 'bookmyshow', categoryKey: 'entertainment', extractionMethod: 'regex' },
  },
  {
    id: 'apollo-pharmacy',
    from: 'Apollo Pharmacy <orders@apollopharmacy.in>',
    subject: 'Invoice for your order',
    daysAgo: 21,
    text: `Thank you for shopping with Apollo Pharmacy.

Invoice date: {{d-m-y4}}
Item total: Rs. 1,420.00
Discount: Rs. 142.00
Total Paid: Rs. 1,278.00`,
    expected: { status: 'parsed', amountMinor: 127800, currency: 'INR', merchantNormalized: 'apollo pharmacy', categoryKey: 'health', extractionMethod: 'regex' },
  },
  {
    id: 'indigo-flight',
    from: 'IndiGo <bookings@goindigo.in>',
    subject: 'Your IndiGo booking is confirmed - BLR to BOM',
    daysAgo: 24,
    text: `Booking reference: XK7P2M

Travel date {{d-m-y4}}
Base fare: Rs 4,120.00
Taxes and fees: Rs 1,109.00
Total amount paid: Rs 5,229.00`,
    expected: { status: 'parsed', amountMinor: 522900, currency: 'INR', merchantNormalized: 'indigo', categoryKey: 'travel', extractionMethod: 'regex' },
  },
  {
    id: 'starbucks-inr',
    from: 'Starbucks India <receipts@tatastarbucks.com>',
    subject: 'Your Starbucks receipt',
    daysAgo: 1,
    text: `Thanks for visiting Starbucks Indiranagar.

1 x Cappuccino Grande
Total charged: Rs. 315.00 on {{d-m-y4}}
Card: ****5512
Stars earned: 15`,
    expected: { status: 'parsed', amountMinor: 31500, currency: 'INR', merchantNormalized: 'starbucks', categoryKey: 'chai', extractionMethod: 'regex' },
  },
  {
    id: 'blinkit-order',
    from: 'Blinkit <no-reply@blinkit.com>',
    subject: 'Order delivered in 11 minutes',
    daysAgo: 3,
    text: `Your Blinkit order was delivered on {{d-m-y4}}.

Item total: Rs 742.00
Handling charge: Rs 12.00
Grand total: Rs 754.00`,
    expected: { status: 'parsed', amountMinor: 75400, currency: 'INR', merchantNormalized: 'blinkit', categoryKey: 'groceries', extractionMethod: 'regex' },
  },
  {
    id: 'cultfit-membership',
    from: 'Cult.fit <care@cult.fit>',
    subject: 'Payment received for your ELITE pack',
    daysAgo: 26,
    text: `Hi Alex, we have received your payment of Rs. 6,999.00 on {{d-m-y4}} for the CULT ELITE 3-month pack.`,
    expected: { status: 'parsed', amountMinor: 699900, currency: 'INR', merchantNormalized: 'cult fit', categoryKey: 'health', extractionMethod: 'regex' },
  },
  {
    id: 'irctc-train',
    from: 'IRCTC <ticketadmin@irctc.co.in>',
    subject: 'Ticket confirmed PNR 4412876655',
    daysAgo: 29,
    text: `Your e-ticket is confirmed.

Journey date: {{d-m-y4}}
Total Fare: Rs 1,845.00
IRCTC convenience fee: Rs 35.40 (included)`,
    expected: { status: 'parsed', amountMinor: 184500, currency: 'INR', merchantNormalized: 'irctc', categoryKey: 'transport', extractionMethod: 'regex' },
  },
  {
    id: 'dominos-order',
    from: "Domino's Pizza <orders@dominos.co.in>",
    subject: 'Your order is out for delivery — bill attached',
    daysAgo: 22,
    text: `Order #DP883211

Pizza and sides
Item total: Rs. 748.00
Taxes: Rs. 37.40
Grand Total: Rs. 785.40
Ordered on {{d-m-y4}}`,
    expected: { status: 'parsed', amountMinor: 78540, currency: 'INR', merchantNormalized: 'dominos', categoryKey: 'food_dining', extractionMethod: 'regex' },
  },
  {
    id: 'croma-electronics',
    from: 'Croma <care@croma.com>',
    subject: 'Tax invoice for your Croma purchase',
    daysAgo: 33,
    text: `Invoice date {{d-m-y4}}

Sony WH-1000XM5
MRP: Rs. 34,990.00
You saved: Rs. 8,000.00
Amount paid: Rs. 26,990.00
Paid via Credit Card ending 5512`,
    expected: { status: 'parsed', amountMinor: 2699000, currency: 'INR', merchantNormalized: 'croma', categoryKey: 'shopping', extractionMethod: 'regex' },
  },
  {
    id: 'euro-hotel-receipt',
    from: 'Hotel Adler <rechnung@hoteladler.de>',
    subject: 'Ihre Rechnung / Your invoice',
    daysAgo: 27,
    text: `Vielen Dank für Ihren Aufenthalt.

Rechnungsdatum: {{d/m/y4}}
Zwischensumme: 1.100,00 EUR
MwSt: 134,56 EUR
Gesamtbetrag bezahlt: 1.234,56 EUR`,
    expected: { status: 'parsed', amountMinor: 123456, currency: 'EUR', merchantNormalized: 'hoteladler', extractionMethod: 'regex' },
  },
  {
    id: 'ola-ride',
    from: 'Ola <care@olacabs.com>',
    subject: 'Your Ola ride receipt',
    daysAgo: 18,
    text: `Ride completed on {{d-m-y4}}

Ride fare: Rs. 212.00
Taxes: Rs. 10.60
Total paid: Rs. 222.60
Paid using Ola Money`,
    expected: { status: 'parsed', amountMinor: 22260, currency: 'INR', merchantNormalized: 'ola', categoryKey: 'transport', extractionMethod: 'regex' },
  },
  {
    id: 'lenskart-purchase',
    from: 'Lenskart <orders@lenskart.com>',
    subject: 'Order confirmation #LK9928213',
    daysAgo: 31,
    text: `Thanks for your order placed on {{d-m-y4}}.

Subtotal: Rs. 4,500.00
Discount: Rs. 900.00
Order Total: Rs. 3,600.00`,
    expected: { status: 'parsed', amountMinor: 360000, currency: 'INR', merchantNormalized: 'lenskart', categoryKey: 'shopping', extractionMethod: 'regex' },
  },
  {
    id: 'unknown-local-cafe',
    from: 'Third Wave Coffee <billing@thirdwavecoffee.in>',
    subject: 'Your bill from Third Wave Coffee Roasters',
    daysAgo: 5,
    text: `Bill No. 88213 · {{d-m-y4}}

2 x Filter Coffee
Item total: Rs. 380.00
CGST: Rs. 9.50
SGST: Rs. 9.50
Bill Total: Rs. 399.00`,
    expected: { status: 'parsed', amountMinor: 39900, currency: 'INR', merchantNormalized: 'third wave coffee', categoryKey: 'chai', extractionMethod: 'regex' },
  },

  // ── Must be rejected ────────────────────────────────────────────────────────
  {
    id: 'hdfc-monthly-statement',
    from: 'HDFC Bank <alerts@hdfcbank.net>',
    subject: 'Your HDFC Bank Credit Card statement is ready',
    daysAgo: 20,
    text: `Dear Card Member,

Your monthly statement for the statement period 01-08-2026 to 31-08-2026 is ready.

Total Amount Due: Rs. 48,221.00
Minimum Amount Due: Rs. 2,411.00
Payment Due Date: 18-09-2026

Please pay by the due date to avoid finance charges.`,
    expected: { status: 'rejected', reasonContains: 'statement' },
  },
  {
    id: 'myntra-marketing',
    from: 'Myntra <offers@myntramail.com>',
    subject: 'FLAT 50% OFF — End of Reason Sale starts now',
    daysAgo: 4,
    text: `Shop now and save big!

Flat 50% off on 2,00,000+ styles. Use code BIGSALE.
Limited time offer. Sale ends Sunday.
Unsubscribe to stop receiving these emails.`,
    expected: { status: 'rejected' },
  },
  {
    id: 'otp-email',
    from: 'ICICI Bank <noreply@icicibank.com>',
    subject: 'Your OTP for login',
    daysAgo: 2,
    text: `Your One Time Password is 884213. It is valid for 10 minutes. Do not share it with anyone.`,
    expected: { status: 'rejected' },
  },
  {
    id: 'delivery-update',
    from: 'Amazon.in <shipment-tracking@amazon.in>',
    subject: 'Your package is out for delivery',
    daysAgo: 3,
    text: `Hello Alex, your package with Anker USB-C Hub is out for delivery today and will arrive by 9 PM.`,
    expected: { status: 'rejected' },
  },
  {
    id: 'newsletter',
    from: 'Product Hunt Daily <hello@producthunt.com>',
    subject: 'Today in tech: 10 products you should see',
    daysAgo: 1,
    text: `Here are today's top products. Read more on our site. Unsubscribe to stop receiving this newsletter.`,
    expected: { status: 'rejected' },
  },
  {
    id: 'flipkart-jsonld-order',
    from: 'Flipkart <noreply@flipkart.com>',
    subject: 'Order confirmed — Bose SoundLink Flex',
    daysAgo: 8,
    html: `<html><head>
<script type="application/ld+json">
{"@context":"http://schema.org","@type":"Order","orderNumber":"OD3348821764",
 "priceCurrency":"INR","price":"12999.00","orderDate":"{{iso}}",
 "merchant":{"@type":"Organization","name":"Flipkart"}}
</script></head>
<body><p>Your order is confirmed and will be delivered soon.</p>
<p>Thanks for shopping with us.</p></body></html>`,
    expected: { status: 'parsed', amountMinor: 1299900, currency: 'INR', merchantNormalized: 'flipkart', categoryKey: 'shopping', extractionMethod: 'jsonld' },
  },
  {
    id: 'hdfc-large-indian-grouping',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'Alert: Update on your HDFC Bank Credit Card',
    daysAgo: 23,
    text: `Dear Card Member,

Rs 1,24,999.00 spent on your HDFC Bank Credit Card xx5512 at APPLE INDIA PVT LTD BANGALORE IN on {{d-m-y4}}.
Available Credit Limit: Rs 25,001.00`,
    expected: { status: 'parsed', amountMinor: 12499900, currency: 'INR', merchantNormalized: 'apple', categoryKey: 'subscriptions', extractionMethod: 'template', accountLast4: '5512' },
  },
  // ── HDFC Pixel Play credit card (its own financial source) ──────────────────
  {
    id: 'hdfc-pixel-chai',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'Update on your HDFC Bank Pixel Play Credit Card',
    daysAgo: 1,
    text: `Dear Card Member,

Rs.148.00 has been spent on your HDFC Bank PIXEL Play Credit Card xx4321 at CHAAYOS BENGALURU on {{d-m-y4}} 08:45:12.
Your available credit limit is Rs.48,852.00.

Not you? Call 18002586161.`,
    expected: {
      status: 'parsed', amountMinor: 14800, currency: 'INR', merchantNormalized: 'chaayos', categoryKey: 'chai',
      extractionMethod: 'template', accountLast4: '4321', sourceKey: 'hdfc_pixel_play', txnKind: 'debit', txnTime: '08:45',
    },
  },
  {
    id: 'hdfc-pixel-refund',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'Refund credited to your Pixel Play Credit Card',
    daysAgo: 8,
    text: `Dear Card Member,

Rs.1,299.00 has been refunded to your HDFC Bank PIXEL Play Credit Card xx4321 from MYNTRA DESIGNS on {{d-m-y4}}.
The amount will reflect in your next statement.`,
    expected: {
      status: 'parsed', amountMinor: 129900, currency: 'INR', merchantNormalized: 'myntra', categoryKey: 'shopping',
      isCredit: true, extractionMethod: 'template', accountLast4: '4321', sourceKey: 'hdfc_pixel_play', txnKind: 'refund',
    },
  },

  // ── Union Bank of India ─────────────────────────────────────────────────────
  {
    id: 'union-upi-grocery',
    from: 'Union Bank of India <alerts@unionbankofindia.com>',
    subject: 'Transaction alert for your Union Bank account',
    daysAgo: 2,
    text: `Dear Customer,

Your A/c XX7788 is debited for Rs.860.00 on {{d-m-y4}} by transfer to VPA bigbasket@ybl (UPI Ref no 419283746501).
Available balance: Rs.14,220.35.
-Union Bank of India`,
    expected: {
      status: 'parsed', amountMinor: 86000, currency: 'INR', merchantNormalized: 'bigbasket', categoryKey: 'groceries',
      extractionMethod: 'template', accountLast4: '7788', sourceKey: 'union_bank', txnKind: 'debit', referenceId: '419283746501',
    },
  },
  {
    id: 'union-card-shopping',
    from: 'Union Bank of India <transactionalert@unionbankofindia.com>',
    subject: 'Debit alert',
    daysAgo: 5,
    text: `Dear Customer,

Rs.1,499.00 debited from your A/c XX7788 on {{d/m/y4}} towards AMAZON PAY INDIA. UTR: 328194756.
Union Bank of India`,
    expected: {
      status: 'parsed', amountMinor: 149900, currency: 'INR', merchantNormalized: 'amazon', categoryKey: 'shopping',
      extractionMethod: 'template', accountLast4: '7788', sourceKey: 'union_bank', txnKind: 'debit', referenceId: '328194756',
    },
  },
  {
    id: 'union-salary-credit',
    from: 'Union Bank of India <alerts@unionbankofindia.com>',
    subject: 'Credit alert for your Union Bank account',
    daysAgo: 14,
    text: `Dear Customer,

Your A/c XX7788 is credited for Rs.45,000.00 on {{d-m-y4}} by transfer from ACME TECHNOLOGIES PVT LTD SALARY (UPI Ref no 55512345678).
Available balance: Rs.59,220.35.
-Union Bank of India`,
    expected: {
      status: 'parsed', amountMinor: 4500000, currency: 'INR', merchantNormalized: 'acme', categoryKey: 'income',
      isCredit: true, extractionMethod: 'template', accountLast4: '7788', sourceKey: 'union_bank', txnKind: 'credit',
    },
  },
];


export function fixtureById(id: string): SampleEmail | undefined {
  return SAMPLE_EMAILS.find((f) => f.id === id);
}