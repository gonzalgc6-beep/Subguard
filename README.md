# SubGuard

Gestor de suscripciones con pago mensual de SubGuard PRO mediante Stripe Checkout. La web y el servidor se sirven desde el mismo origen. Las claves secretas de Stripe se mantienen solo en el servidor.

## Ejecutar localmente

Requiere Node.js 20 o posterior y una cuenta de Stripe.

```bash
pnpm install
Copy-Item .env.example .env
```

En `.env`, introduce una clave **de prueba** `sk_test_...` de Stripe y genera un secreto aleatorio para `COOKIE_SECRET` (al menos 32 caracteres). Después ejecuta:

```bash
pnpm start
```

Abre `http://localhost:4242`. En modo de prueba usa una tarjeta de prueba de Stripe, como `4242 4242 4242 4242`, con una fecha futura y cualquier CVC. No uses datos de una tarjeta real en modo de prueba.

## Publicar

GitHub Pages solo sirve archivos estáticos y no puede guardar `STRIPE_SECRET_KEY` ni ejecutar este servidor. Publica el repositorio en GitHub y despliega la carpeta `subguard` como servicio Node en un host que ejecute Node.js. Configura allí:

- `STRIPE_SECRET_KEY`: primero usa `sk_test_...`; para cobrar de verdad se requiere `sk_live_...` de una cuenta Stripe activada.
- `COOKIE_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `APP_URL`: URL HTTPS pública del servicio.
- `NODE_ENV=production`.

El servicio aplica HTTPS al cookie de plan y crea la sesión de Checkout en el servidor. La app solo activa PRO después de verificar con Stripe que la sesión completada pertenece a ese navegador y que la suscripción está activa. El estado se vuelve a consultar a Stripe y deja de dar PRO cuando la suscripción ya no está activa.

## Alcance actual

El pago es una suscripción recurrente de 4,99 €/mes en EUR. El backend de Stripe ya queda conectado, pero el cobro real requiere que el propietario configure su cuenta Stripe y sus claves live. Los datos de suscripciones que se gestionan en la app siguen guardándose en el navegador; esta versión no incluye cuentas de usuario ni sincronización entre dispositivos.
