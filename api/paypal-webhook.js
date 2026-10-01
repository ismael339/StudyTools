// PayPal webhook: keeps entitlements honest after the checkout.
//
// The browser can start a subscription but it must not be able to end or extend
// one, so every renewal, cancellation, suspension and refund is processed here
// with the service account. Configure the endpoint as
// https://www.studytools.pro/api/paypal-webhook and add PAYPAL_WEBHOOK_ID in
// Vercel so the signature of every delivery can be checked.

import { applyEntitlement, adminEnabled, claimEvent, isPassSku, parseDate, planFromSku, getAdmin } from '../lib/admin.js';

const PAYPAL_API = process.env.PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// Cancelling stops future renewals, not the period already paid for, so Pro is
// kept until this moment and only then withdrawn.
const KEEP_UNTIL_NOW_STATUSES = ['CANCELLED'];

let paypalToken = null;
let paypalTokenExpiry = 0;

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  if (paypalToken && Date.now() < paypalTokenExpiry) return paypalToken;
  const response = await fetch(PAYPAL_API + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) return null;
  const data = await response.json();
  paypalToken = data.access_token;
  paypalTokenExpiry = Date.now() + Math.max(300, Number(data.expires_in || 300) - 60) * 1000;
  return paypalToken;
}

async function verifyDelivery(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return 'skipped';
  const accessToken = await getPayPalAccessToken();
  if (!accessToken || !rawBody) return 'skipped';
  const response = await fetch(PAYPAL_API + '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify({
      transmission_id: headers['paypal-transmission-id'],
      transmission_time: headers['paypal-transmission-time'],
      transmission_sig: headers['paypal-transmission-sig'],
      cert_url: headers['paypal-cert-url'],
      auth_algo: headers['paypal-auth-algo'],
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody)
    })
  });
  if (!response.ok) return 'skipped';
  const data = await response.json();
  return data.verification_status === 'SUCCESS' ? 'verified' : 'failed';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (!event || !event.event_type) {
    return res.status(400).json({ error: 'Missing event_type' });
  }

  const verification = await verifyDelivery(req.headers, rawBody);
  if (verification === 'failed') {
    return res.status(403).json({ error: 'Signature verification failed' });
  }

  if (!adminEnabled()) {
    // Answer 200 so PayPal stops retrying, but do not guess at entitlements.
    console.error('Webhook received without FIREBASE_SERVICE_ACCOUNT:', event.event_type, event.id);
    return res.status(200).json({ received: true, applied: false, reason: 'admin_not_configured' });
  }

  const admin = getAdmin();
  if (!admin) return res.status(200).json({ received: true, applied: false, reason: 'admin_unavailable' });

  // PayPal retries deliveries, and a renewal must never be counted twice.
  const claimed = await claimEvent(admin.db, event.id);
  if (!claimed) {
    return res.status(200).json({ received: true, applied: false, reason: 'duplicate' });
  }

  const resource = event.resource || {};
  const type = event.event_type;
  const subscriptionId = String(resource.id || resource.billing_agreement_id || '');
  const payerEmail = String(
    (resource.payer && resource.payer.email_address) || resource.email || ''
  ).toLowerCase();
  const sku = String(resource.plan_id || (resource.billing_cycles && resource.billing_cycles[0] && resource.billing_cycles[0].plan_id) || '');
  const periodEnd = parseDate(
    resource.billing_info && resource.billing_info.next_billing_time ? resource.billing_info.next_billing_time : ''
  );
  const status = String(resource.status || '').toUpperCase();

  try {
    // One-time purchase (an exam pass bought through a PayPal button).
    if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'PAYMENT.SALE.COMPLETED') {
      if (!isPassSku(sku)) {
        return res.status(200).json({ received: true, applied: false, reason: 'not_a_pass' });
      }
      const result = await applyEntitlement({
        email: payerEmail,
        plan: 'premium',
        sku: sku || 'pass-7d',
        subscriptionId: subscriptionId || resource.custom_id || 'order-' + (event.id || ''),
        captureId: resource.id,
        periodEnd: Date.now() + 7 * 86400000,
        status: 'COMPLETED',
        source: 'paypal-webhook',
        eventType: type,
        payerEmail: payerEmail
      });
      return res.status(200).json({ received: true, applied: result.ok, result });
    }

    if (type.indexOf('BILLING.SUBSCRIPTION') !== 0 && type.indexOf('PAYMENT.SALE') !== 0) {
      return res.status(200).json({ received: true, applied: false, reason: 'event_ignored' });
    }

    if (!subscriptionId) {
      return res.status(200).json({ received: true, applied: false, reason: 'no_subscription_id' });
    }

    // Refunds and failed renewals end access right away.
    if (type === 'PAYMENT.SALE.REFUNDED' || type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      const result = await applyEntitlement({
        email: payerEmail,
        plan: 'free',
        subscriptionId: subscriptionId,
        status: 'REVOKED',
        source: 'paypal-webhook',
        eventType: type
      });
      return res.status(200).json({ received: true, applied: result.ok, result });
    }

    const revoked = ['SUSPENDED', 'EXPIRED'].indexOf(status) >= 0;
    const cancelKeepsPeriod = KEEP_UNTIL_NOW_STATUSES.includes(status) && periodEnd && periodEnd > Date.now();

    if (revoked || (!cancelKeepsPeriod && ['CANCELLED', 'TERMINATED'].indexOf(status) >= 0)) {
      const result = await applyEntitlement({
        email: payerEmail,
        plan: 'free',
        subscriptionId: subscriptionId,
        status: status,
        source: 'paypal-webhook',
        eventType: type
      });
      return res.status(200).json({ received: true, applied: result.ok, result });
    }

    // Activated, renewed or simply updated: confirm with PayPal and refresh the
    // period end so a yearly plan does not silently fall back to free.
    let verifiedSku = sku;
    let verifiedStatus = status || 'ACTIVE';
    let verifiedEnd = periodEnd;
    const accessToken = await getPayPalAccessToken();
    if (accessToken) {
      const lookup = await fetch(PAYPAL_API + '/v2/billing/subscriptions/' + encodeURIComponent(subscriptionId), {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      if (lookup.ok) {
        const fresh = await lookup.json();
        verifiedSku = String(fresh.plan_id || verifiedSku);
        verifiedStatus = String(fresh.status || verifiedStatus);
        verifiedEnd = parseDate(
          (fresh.billing_info && fresh.billing_info.next_billing_time) || ''
        ) || verifiedEnd;
      }
    }

    if (verifiedStatus !== 'ACTIVE') {
      return res.status(200).json({ received: true, applied: false, reason: 'not_active', status: verifiedStatus });
    }

    const result = await applyEntitlement({
      email: payerEmail,
      plan: planFromSku(verifiedSku),
      sku: verifiedSku,
      subscriptionId: subscriptionId,
      periodEnd: isPassSku(verifiedSku) ? Date.now() + 7 * 86400000 : verifiedEnd,
      status: verifiedStatus,
      cancelAtPeriodEnd: Boolean(resource.cancel_at_period_end),
      source: 'paypal-webhook',
      eventType: type,
      payerEmail: payerEmail
    });
    return res.status(200).json({ received: true, applied: result.ok, result });
  } catch (error) {
    console.error('Webhook processing failed:', error && error.message);
    return res.status(500).json({ error: 'Could not process the event' });
  }
}