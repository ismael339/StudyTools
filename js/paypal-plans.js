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
  clientId: 'BAA7gPQPf9ATShT_E7GDRdQXYhiFyYt6_29rVWpF_96_W15AAC44z9dS71rkoJBlnkuh0H13mKZqQv5T5w',
  // The plan ids below were created on the previous PayPal app. PayPal ties a
  // plan to the app that created it, so if the buttons refuse to open, recreate
  // these two plans on the current app and put the new ids here. The prices and
  // the skus must stay the same, otherwise pro.html would show a different
  // price than the one charged.
  // The two plan ids were created on the previous PayPal app. PayPal ties a
  // plan to the app that created it, so if the buttons refuse to open, recreate
  // these plans on the current app and put the new ids here. Keep the prices and
  // skus unchanged, otherwise pro.html would show a different price than the
  // amount actually charged.
  currency: 'EUR',
  monthly: { id: 'P-5GW019469S153851ANLBHLNQ', sku: 'pro-monthly', label: 'Pro Monthly', price: 3.99, period: 'month' },
  yearly: { id: 'P-17W830833G852291FNLBHLNY', sku: 'pro-yearly', label: 'Pro Yearly', price: 29.99, period: 'year' },
  freeDailyAi: 15,
  proDailyAi: 2000,
  priceText: function (key) {
    var plan = this[key];
    if (!plan) return '';
    return plan.price.toFixed(2).replace('.', ',') + ' EUR / ' + plan.period;
  }
};