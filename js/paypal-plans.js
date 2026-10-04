/**
 * Single source of truth for the paid plans.
 *
 * These are the live PayPal plan ids already connected to the checkout on
 * /pro.html. If you change a price in the PayPal dashboard you must create a
 * new plan there and update the id here plus the price in pro.html, so the page
 * and the charge always match.
 */
window.StudyToolsPlans = {
  // Live PayPal client id. pro.html loads the SDK from here, so switching to a
  // different PayPal app means editing this line and the PAYPAL_CLIENT_ID
  // variable in Vercel, nothing else.
  clientId: '',
  currency: 'EUR',
  monthly: { id: 'P-44976517YC761723RNI6W5AY', sku: 'pro-monthly', label: 'Pro Monthly', price: 3.99, period: 'month' },
  yearly: { id: 'P-14N28530X9822712DNI6W7NQ', sku: 'pro-yearly', label: 'Pro Yearly', price: 29.99, period: 'year' },
  freeDailyAi: 15,
  proDailyAi: 2000,
  priceText: function (key) {
    var plan = this[key];
    if (!plan) return '';
    return plan.price.toFixed(2).replace('.', ',') + ' EUR / ' + plan.period;
  }
};