// One-off setup: creates the two subscription plans on the current PayPal app.
//
// The plans in js/paypal-plans.js belonged to the previous app and PayPal
// answers 404 for them, so the checkout could not charge anything. This creates
// the same two plans, with the same prices, SKUs and return URLs, on the app
// whose credentials are configured in Vercel.
//
// The definitions are hardcoded on purpose: the endpoint accepts no input, so
// it cannot create arbitrary products or change prices. Calling it twice is
// safe, it looks for an existing plan on the product first.

function clean(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

const PLANS = [
  { key: 'monthly', sku: 'pro-monthly', name: 'StudyTools Pro Monthly', amount: '3.99', interval: 'MONTH' },
  { key: 'yearly', sku: 'pro-yearly', name: 'StudyTools Pro Yearly', amount: '29.99', interval: 'YEAR' }
];

async function accessToken() {
  const clientId = clean(process.env.PAYPAL_CLIENT_ID);
  const secret = clean(process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET || process.env.PAYPAL_API_SECRET || process.env.PAYPAL_API_SECRET_KEY);
  const api = (process.env.PAYPAL_ENV || 'live') === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
  const response = await fetch(api + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error('PayPal auth failed (' + response.status + ')');
  const data = await response.json();
  return { token: data.access_token, api };
}
async function createProduct(api, token, plan) {
  const response = await fetch(api + '/v1/catalogs/products', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': 'st-prod-' + plan.sku + '-' + Date.now()
    },
    body: JSON.stringify({
      name: plan.name,
      description: 'StudyTools Pro subscription',
      type: 'SERVICE',
      category: 'SOFTWARE'
    })
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error('product failed (' + response.status + '): ' + (data.message || 'unknown'));
  return data.id;
}

async function existingPlan(api, token, productId) {
  const url = api + '/v1/billing/plans?product_id=' + encodeURIComponent(productId) + '&page=1&page_size=20';
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) return null;
  const data = await response.json().catch(function () { return {}; });
  return (data.plans && data.plans.length) ? data.plans[0].id : null;
}

async function createPlan(api, token, plan, productId) {
  const body = {
    product_id: productId,
    name: plan.name,
    description: 'StudyTools Pro subscription, billed by PayPal',
    status: 'ACTIVE',
    billing_cycles: [{
      frequency: { interval_unit: plan.interval, interval_count: 1 },
      tenure_type: 'REGULAR',
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value: plan.amount, currency_code: 'EUR' } }
    }],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 }
  };
  const response = await fetch(api + '/v1/billing/plans', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': 'st-plan-' + plan.sku + '-' + Date.now()
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error('plan failed (' + response.status + '): ' + (data.message || 'unknown'));
  return data.id;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.PAYPAL_CLIENT_ID || !clean(process.env.PAYPAL_API_SECRET || process.env.PAYPAL_SECRET)) {
    return res.status(503).json({ error: 'PayPal credentials are not configured' });
  }

  let auth;
  try {
    auth = await accessToken();
  } catch (error) {
    return res.status(502).json({ error: (error && error.message) || 'PayPal auth failed' });
  }

  const site = (process.env.SITE_URL || 'https://www.studytools.pro').replace(/\/$/, '');
  const results = [];

  for (const plan of PLANS) {
    try {
      const productId = await createProduct(auth.api, auth.token, plan);
      let planId = await existingPlan(auth.api, auth.token, productId);
      const created = !planId;
      if (!planId) planId = await createPlan(auth.api, auth.token, plan, productId);
      results.push({ key: plan.key, sku: plan.sku, planId, productId, created, amount: plan.amount, currency: 'EUR', interval: plan.interval });
    } catch (error) {
      results.push({ key: plan.key, sku: plan.sku, error: (error && error.message) || 'unknown' });
    }
  }

  return res.status(200).json({
    ok: results.every(function (r) { return Boolean(r.planId); }),
    successUrl: site + '/pro-success.html',
    cancelUrl: site + '/pro.html',
    results: results
  });
}