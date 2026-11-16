import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Stripe from 'stripe';

const app = express();
const port = Number(process.env.PORT || 4242);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
const cookieSecret = process.env.COOKIE_SECRET || '';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const production = process.env.NODE_ENV === 'production';
const currentDir = path.dirname(fileURLToPath(import.meta.url));

if (cookieSecret.length < 32) {
  console.error('COOKIE_SECRET debe tener al menos 32 caracteres aleatorios.');
  process.exit(1);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signCookie(name, value) {
  const payload = encode(value);
  const signature = crypto.createHmac('sha256', cookieSecret).update(`${name}.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

function readCookie(req, name) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const token = cookies[name];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', cookieSecret).update(`${name}.${payload}`).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try { return Buffer.from(payload, 'base64url').toString(); } catch { return null; }
}

function setCookie(res, name, value, maxAge) {
  const flags = [
    `${name}=${signCookie(name, value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (production) flags.push('Secure');
  res.append('Set-Cookie', flags.join('; '));
}

function ensureDevice(req, res, next) {
  let deviceId = readCookie(req, 'sg_device');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    setCookie(res, 'sg_device', deviceId, 60 * 60 * 24 * 365);
  }
  req.deviceId = deviceId;
  next();
}

function requireStripe(_req, res, next) {
  if (!stripe) return res.status(503).json({ error: 'Pagos no configurados. Añade STRIPE_SECRET_KEY en el servidor.' });
  next();
}

app.use(express.json({ limit: '10kb' }));
app.use('/api', ensureDevice);
app.use('/api', requireStripe);

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: req.deviceId,
      metadata: { device_id: req.deviceId },
      subscription_data: { metadata: { device_id: req.deviceId } },
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: 499,
          recurring: { interval: 'month' },
          product_data: { name: 'SubGuard PRO', description: 'Suscripción mensual a SubGuard PRO' }
        },
        quantity: 1
      }],
      success_url: `${appUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?checkout=cancelled`
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Checkout error:', error.message);
    res.status(502).json({ error: 'Stripe no pudo iniciar el pago. Inténtalo de nuevo.' });
  }
});

app.post('/api/activate', async (req, res) => {
  const { sessionId } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'Sesión de pago no válida.' });
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (session.client_reference_id !== req.deviceId || session.status !== 'complete') {
      return res.status(403).json({ error: 'La sesión no corresponde a este navegador o el pago no se completó.' });
    }
    const subscription = session.subscription;
    if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
      return res.status(402).json({ error: 'La suscripción aún no está activa. Comprueba el pago en Stripe.' });
    }
    setCookie(res, 'sg_pro', `${req.deviceId}:${subscription.id}`, 60 * 60 * 24 * 365);
    res.json({ isPro: true });
  } catch (error) {
    console.error('Stripe activation error:', error.message);
    res.status(502).json({ error: 'No se pudo verificar la suscripción con Stripe.' });
  }
});

app.get('/api/entitlement', async (req, res) => {
  const entitlement = readCookie(req, 'sg_pro');
  if (!entitlement) return res.json({ isPro: false });
  const separator = entitlement.indexOf(':');
  const deviceId = entitlement.slice(0, separator);
  const subscriptionId = entitlement.slice(separator + 1);
  if (separator < 0 || deviceId !== req.deviceId || !subscriptionId.startsWith('sub_')) {
    return res.json({ isPro: false });
  }
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const valid = subscription.metadata.device_id === req.deviceId && ['active', 'trialing'].includes(subscription.status);
    res.json({ isPro: valid });
  } catch (error) {
    console.error('Stripe entitlement error:', error.message);
    res.status(502).json({ error: 'No se pudo consultar la suscripción.' });
  }
});

app.use(express.static(currentDir));
app.listen(port, () => console.log(`SubGuard listo en ${appUrl}`));
