# Content, microcopy and internationalisation

Version 1.1 · 2026-11-12 · owner ux-designer · Stories **US-115, US-116, US-117, US-119, US-120, US-036, US-106** and every screen · NFR-I18N-001..004 · D-023 · v1.1 adds §4.9–§4.13 (sessions, re-authentication, admin idle timeout, CVC re-collection, e-mail additions), the `sessions` and `reauth` shared namespaces, and new `errors:` keys (G2-C4)

The es and fr strings here are developer-quality drafts. They are tracked as "pending linguistic review" (D-023, US-115) and are not final legal or marketing copy.

## 1. Voice and tone

| Principle | Do | Don't |
|---|---|---|
| Plain and direct | "Your shipment is booked." | "Your booking request has been successfully processed." |
| Second person, active voice | "Choose a pickup date." | "A pickup date must be selected." |
| Say what happened and what to do | "Your bank declined this card. Try another card or contact your bank." | "Error 402: payment failed." |
| No blame, no jokes in errors | "That code didn't work." | "Oops! Wrong code!" |
| Explain shipping jargon once, where it matters | "Who pays import duties?" with "(DAP)" as secondary text | "Select Incoterm." |
| Sentence case everywhere | "Get quotes", "Track a shipment" | "Get Quotes" |
| Buttons start with a verb and say the outcome | "Pay USD 65.00", "Delete draft", "Book this service" | "OK", "Submit", "Yes" |
| Absolute times and explicit currency at money moments | "Prices valid until 13 Nov, 14:30 EST", "Amount to be charged: USD 65.00" | "Valid for 24 hours", "$65" at checkout |
| Honest about state | "You haven't been charged." "Sample data — not legal advice." | Implying certainty where data is unreviewed |
| Brand neutral | `{BRAND_NAME}` from configuration only. "We" means the Platform. | Any literal brand name in strings (lint fails, US-108) |

Address forms: **es uses "tú"** (informal, matching the friendly English "you"). **fr uses "vous"**. French avoids gendered past participles addressed to the user by rephrasing ("Votre session a pris fin" instead of "Vous avez été déconnecté(e)").

## 2. i18n key conventions (D-UX-028)

### 2.1 Files and namespaces

- One JSON file per namespace per locale: `apps/web/src/locales/{lng}/{ns}.json`, `apps/admin/src/locales/{lng}/{ns}.json`. Shared namespaces live in `packages/ui/locales/{lng}/{ns}.json`.
- Locales: `en` (source), `es`, `fr`, plus `pseudo` (non-production only, US-120).

| Namespace | Owner app | Contents |
|---|---|---|
| `common` | ui (shared) | Generic actions (Save, Cancel, Close, Copy, Copied, Try again), loading labels, pagination |
| `a11y` | ui | Accessible-only strings (skip link, "opens in a new tab", landmark labels, announcer messages) |
| `errors` | ui | One key per API error code (DR-A26 + domain codes), verbatim UPPER_SNAKE: `errors:CARD_DECLINED` |
| `validation` | ui | Validation sub-codes and client rules: `validation:PASSWORD_POLICY`, `validation:required`, `validation:postcodePattern` |
| `status` | ui | Canonical shipment and tracking statuses: `status:shipment.IN_TRANSIT`, `status:tracking.OUT_FOR_DELIVERY`, outcomes `status:outcome.DENIED` |
| `enums` | ui | Other enumerations: `enums:reasonForExport.GIFT`, `enums:incoterm.DAP`, `enums:contentType.DOCUMENT`, `enums:auditAction.LOGIN` |
| `units` | ui | Unit patterns: `units:dimensions`, `units:system.metric` |
| `address` | ui | Address field labels by type: `address:postcodeLabel.pin`, `address:subdivisionLabel.province` |
| `shell` | web, admin | Header, footer, navigation, switchers, environment chip |
| `home`, `quote`, `results` | web | Home and widget, results page |
| `auth` | web, admin | Sign-in, register, verify, reset, MFA, recovery codes |
| `booking` | web | Wizard shell, steps 1–5, the service re-select step |
| `customs` | web | Contents step customs and DG |
| `collection` | web | Pickup and drop-off |
| `checkout`, `confirmation` | web | Payment, progress, confirmation |
| `tracking` | web | Public and authenticated tracking |
| `account`, `shipments`, `documents` | web | Account area |
| `legal`, `help` | web | Static page content |
| `audit` | admin | Audit viewer |
| `sessions` | ui (shared, v1.1) | `SessionList` ("Where you're signed in" / My sessions), used by web S-C07 and admin S-D08 (US-027) |
| `reauth` | ui (shared, v1.1) | ReauthDialog "Confirm it's you" (US-291); one purpose key per `ReauthRequest.action_scope`, with dots in the scope written as underscores (`reauth:purpose.payment_method_manage`); a CI check enumerates the contract enum |
| `email` | api/worker templates | `email:{TEMPLATE}.subject`, `.preheader`, `.heading`, `.intro`, `.cta`, `.footer.*` |

### 2.2 Key format

- `namespace:area.element[.variant]`, with lowerCamelCase segments, max depth 4. For example `results:card.badge.cheapest`, `booking:step.addresses.title`.
- **Keys are semantic, not textual:** `checkout:pay.action`, not `checkout:payNow`.
- Standard leaf names: `title`, `description`, `label`, `hint`, `placeholder`, `action`, `aria` (accessible-only), `empty.title`, `empty.description`, `error.title`, `meta.title`, `meta.description`.
- **Enumerations and error codes use the canonical code verbatim** as the last segment, so lookups are generated (`status:shipment.${code}`) and a CI check verifies each enum value has a key in every locale.
- **No key reuse across contexts.** "Cancel" in a dialog (`common:cancel`) and "Cancel shipment" (`shipments:detail.cancel.action`) are different keys.
- **Translator context:** each namespace has a sibling `{ns}.context.json` (en only) mapping key → description, max length and placeholder meaning. It is excluded from runtime bundles.

### 2.3 Message syntax

- **ICU MessageFormat** for plurals, selects and numbers (US-115, REQ-I18N-013). For example `{count, plural, one {# shipment} other {# shipments}}`. The i18next ICU integration is a dependency choice for principal-architect (ADR). If not adopted, i18next's native plural suffixes (`_one`, `_many`, `_other`) are the fallback, with the same semantics.
- Placeholders are named (`{amount}`, `{date}`, `{count}`), never positional.
- **Money, dates, weights and dimensions are formatted by the shared helpers** (§5) and passed in as strings. ICU number skeletons are not used for money or units, so there is one formatting source (NFR-I18N-004). Counts use `{count, number}` or `#`.
- **No concatenation** (US-115). A sentence with a link or emphasis uses react-i18next `<Trans>` with named tags: `"agree": "I agree to the <terms>Terms</terms>."`. HTML strings are never used.
- **Plural categories:** en uses `one/other`; es uses `one/many/other` (the CLDR `many` applies to large round numbers such as 1,000,000: "1 millón **de** envíos"); fr uses `one/many/other` (fr `one` includes 0 and 1). Include `many` for es and fr wherever the count is unbounded.
- Gender: avoid gendered constructions addressed to the user. Use ICU `select` only for grammatical objects with a known gender.
- **Proper nouns inside sentences:** avoid placing country names after prepositions ("to {country}" → fr "vers l'Inde" needs an article). Prefer the colon form ("Destination: {country}") or a context-free phrase ("this destination"), because `Intl.DisplayNames` returns bare names.

### 2.4 Pseudo-locale (US-120)

`pseudo` = en with accented characters and +30% length padding, wrapped in brackets: `[Ĝéţ ǫûöţéš ·········]`. Non-production builds only (`?lng=pseudo`). It is used by the Playwright overflow checks at 360 and 1280 px (NFR-I18N-003).

## 3. Layout rules for text expansion and RTL readiness

- Design for +30% (es and fr are often 15–30% longer than en). Buttons grow in height (wrap) rather than truncate. Navigation collapses to the drawer when it no longer fits (W00 §7).
- Truncation is allowed only for user data (names, IDs, hashes) with the full value available (tooltip + accessible name). Labels and messages never truncate.
- No fixed widths on text containers. Use `min-inline-size` for buttons.
- Logical CSS properties only (`margin-inline-start`, `inset-inline-end`, `text-align: start`). Icons that imply direction (chevrons, arrows such as "→" in routes) flip under `dir="rtl"` via `:dir(rtl)` transforms. No RTL locale ships now (US-120).
- Route arrows ("US 10001 → IN 400001") are a formatting pattern key `results:summary.route` so RTL can reorder.

## 4. Microcopy catalogue (critical strings, en / es / fr)

### 4.1 Shell and shared states

| Key | en | es | fr |
|---|---|---|---|
| `a11y:skipToContent` | Skip to content | Saltar al contenido | Aller au contenu |
| `shell:nav.getQuote` | Get a quote | Pedir presupuesto | Obtenir un devis |
| `shell:nav.track` | Track | Seguimiento | Suivi |
| `shell:nav.prohibited` | Prohibited items | Artículos prohibidos | Articles interdits |
| `shell:signIn` | Sign in | Iniciar sesión | Se connecter |
| `shell:signOut` | Sign out | Cerrar sesión | Se déconnecter |
| `shell:env.test` | Test environment | Entorno de pruebas | Environnement de test |
| `common:offline.banner` | You're offline. We'll keep what you've entered. | No tienes conexión. Guardaremos lo que has introducido. | Vous êtes hors ligne. Nous conservons ce que vous avez saisi. |
| `common:offline.back` | You're back online. | Vuelves a tener conexión. | Vous êtes de nouveau en ligne. |
| `common:offline.reason` | You're offline | No tienes conexión | Vous êtes hors ligne |
| `common:error.title` | Something went wrong | Algo ha fallado | Un problème est survenu |
| `common:error.retry` | Try again | Volver a intentarlo | Réessayer |
| `common:error.reference` | Reference: {id} | Referencia: {id} | Référence : {id} |
| `common:denied.title` | You don't have access to this page | No tienes acceso a esta página | Vous n'avez pas accès à cette page |
| `common:denied.description` | Your role doesn't include this. Ask an owner or administrator if you need it. | Tu rol no incluye este acceso. Si lo necesitas, pídeselo a un propietario o administrador. | Votre rôle ne donne pas accès à cette page. Si vous en avez besoin, demandez-le à un propriétaire ou à un administrateur. |
| `common:notFound.title` | Page not found | Página no encontrada | Page introuvable |
| `common:goHome` | Go home | Ir al inicio | Retour à l'accueil |
| `common:copied` | Copied | Copiado | Copié |
| `common:rateLimited.title` | Wait a moment | Espera un momento | Patientez un instant |
| `common:retry.available` | You can try again now. | Ya puedes volver a intentarlo. | Vous pouvez réessayer maintenant. |
| `validation:summary.title` | {count, plural, one {There is # problem to fix} other {There are # problems to fix}} | {count, plural, one {Hay # problema que corregir} many {Hay # de problemas que corregir} other {Hay # problemas que corregir}} | {count, plural, one {# problème à corriger} many {# de problèmes à corriger} other {# problèmes à corriger}} |
| `address:field.postcode.pin.required` | Enter a PIN code | Introduce un código PIN | Saisissez un code PIN |

Required-field messages are **one complete key per field**, for example `address:field.postcode.pin.required`. There is no generic "Enter {field}" template, because inserting a noun phrase into a sentence breaks gender and article agreement in es and fr (US-115, no concatenation). A lint rule flags any message key that takes another translated string as a placeholder.

### 4.2 Quote and results

| Key | en | es | fr |
|---|---|---|---|
| `home:hero.title` | Compare carriers and ship worldwide | Compara transportistas y envía a todo el mundo | Comparez les transporteurs et expédiez partout dans le monde |
| `quote:widget.residential.label` | Delivering to a home address | Entrega en un domicilio particular | Livraison à une adresse résidentielle |
| `quote:widget.live.billable` | Billable {billable} (volumetric {volumetric}) | Facturable: {billable} (volumétrico: {volumetric}) | Facturable : {billable} (volumétrique : {volumetric}) |
| `quote:widget.submit` | Get quotes | Ver precios | Voir les tarifs |
| `results:status.progress` | {done, number} of {total, plural, one {# carrier} other {# carriers}} responded | Han respondido {done, number} de {total, plural, one {# transportista} other {# transportistas}} | {done, plural, one {# transporteur sur {total} a répondu} other {# transporteurs sur {total} ont répondu}} |
| `results:banner.partial` | Some carriers didn't respond. Prices shown are from {done} of {total}. | Algunos transportistas no han respondido. Los precios mostrados son de {done} de {total}. | Certains transporteurs n'ont pas répondu. Les tarifs affichés proviennent de {done} sur {total}. |
| `results:card.badge.cheapest` | Cheapest | Más barato | Le moins cher |
| `results:card.badge.fastest` | Fastest | Más rápido | Le plus rapide |
| `results:card.badge.cheapestProvisional` | Cheapest so far | Más barato por ahora | Le moins cher pour l'instant |
| `results:card.badge.fastestProvisional` | Fastest so far | Más rápido por ahora | Le plus rapide pour l'instant |
| `results:card.transitDays` | {days, plural, one {# business day} other {# business days}} | {days, plural, one {# día hábil} many {# de días hábiles} other {# días hábiles}} | {days, plural, one {# jour ouvré} many {# de jours ouvrés} other {# jours ouvrés}} |
| `results:card.cutoff` | Book by {time} · {remaining} left | Reserva antes de las {time} · quedan {remaining} | Réservez avant {time} · encore {remaining} |
| `results:card.printer.required` | Printer needed for label | Necesitas impresora para la etiqueta | Imprimante nécessaire pour l'étiquette |
| `results:card.printer.notRequired` | No printer needed | No necesitas impresora | Pas besoin d'imprimante |
| `results:card.book` | Book this service | Reservar este servicio | Réserver ce service |
| `results:expired.banner` | These prices expired at {datetime}. Get new prices to continue. | Estos precios caducaron el {datetime}. Obtén precios nuevos para continuar. | Ces tarifs ont expiré le {datetime}. Obtenez de nouveaux tarifs pour continuer. |
| `results:expired.action` | Get new prices | Obtener precios nuevos | Obtenir de nouveaux tarifs |
| `results:requote.priceChanged` | Price changed: was {old}, now {new} ({diff}) | El precio ha cambiado: antes {old}, ahora {new} ({diff}) | Le prix a changé : {old} auparavant, {new} maintenant ({diff}) |
| `results:empty.limits.title` | No services can carry this shipment | Ningún servicio puede transportar este envío | Aucun service ne peut transporter cet envoi |
| `results:carrier.notice.timeout` | {carrier} didn't respond in time. | {carrier} no ha respondido a tiempo. | {carrier} n'a pas répondu à temps. |
| `results:carrier.notice.error` | {carrier} couldn't give a price right now. | {carrier} no ha podido dar un precio ahora mismo. | {carrier} n'a pas pu fournir de tarif pour le moment. |
| `results:shared.unavailable` | This shared quote is no longer available. Ask the sender for a new link, or get your own quote. | Este presupuesto compartido ya no está disponible. Pide un enlace nuevo a quien te lo envió u obtén tu propio presupuesto. | Ce devis partagé n'est plus disponible. Demandez un nouveau lien à l'expéditeur ou obtenez votre propre devis. |
| `results:share.replacesPrevious` | Creating a new link turns off the previous link for this quote. | Al crear un enlace nuevo, el anterior de este presupuesto deja de funcionar. | La création d'un nouveau lien désactive le lien précédent de ce devis. |
| `results:carrier.notice.CARRIER_BUSY` | {carrier} is busy right now. Try again in a few minutes. | {carrier} está ocupado ahora mismo. Vuelve a intentarlo dentro de unos minutos. | {carrier} est très sollicité en ce moment. Réessayez dans quelques minutes. |

### 4.3 Authentication

| Key | en | es | fr |
|---|---|---|---|
| `auth:signIn.title` | Sign in | Iniciar sesión | Connexion |
| `auth:signIn.signedOut` | You were signed out. Sign in again to continue. | Se ha cerrado tu sesión. Vuelve a iniciar sesión para continuar. | Votre session a pris fin. Reconnectez-vous pour continuer. |
| `auth:register.checkInbox` | We've sent a link to {email}. Open it to verify your email. | Hemos enviado un enlace a {email}. Ábrelo para verificar tu correo electrónico. | Nous avons envoyé un lien à {email}. Ouvrez-le pour vérifier votre adresse e-mail. |
| `auth:password.hint` | At least 12 characters. Avoid common passwords. | Al menos 12 caracteres. Evita contraseñas habituales. | Au moins 12 caractères. Évitez les mots de passe courants. |
| `auth:password.show` | Show password | Mostrar contraseña | Afficher le mot de passe |
| `auth:mfa.code.label` | Code from your authenticator app | Código de tu aplicación de autenticación | Code de votre application d'authentification |
| `auth:mfa.useRecovery` | Use a recovery code instead | Usar un código de recuperación | Utiliser un code de récupération |
| `auth:recovery.title` | Save your recovery codes | Guarda tus códigos de recuperación | Enregistrez vos codes de récupération |
| `auth:recovery.ack` | I've saved my recovery codes somewhere safe. | He guardado mis códigos de recuperación en un lugar seguro. | J'ai enregistré mes codes de récupération en lieu sûr. |
| `auth:recovery.leave` | Leave without saving your codes? You won't be able to see them again. | ¿Salir sin guardar tus códigos? No podrás volver a verlos. | Quitter sans enregistrer vos codes ? Vous ne pourrez plus les afficher. |

### 4.4 Booking, checkout and confirmation

| Key | en | es | fr |
|---|---|---|---|
| `booking:progress.label` | Step {current} of {total}: {step} | Paso {current} de {total}: {step} | Étape {current} sur {total} : {step} |
| `booking:actions.continue` | Save and continue | Guardar y continuar | Enregistrer et continuer |
| `booking:rateChange.hint` | Changing this updates your price. | Si cambias esto, se actualizará el precio. | Modifier ce champ met à jour le prix. |
| `customs:dg.label` | This shipment contains no dangerous goods | Este envío no contiene mercancías peligrosas | Cet envoi ne contient aucune marchandise dangereuse |
| `customs:dg.examples` | For example: lithium batteries, aerosols, flammable liquids, compressed gas. | Por ejemplo: baterías de litio, aerosoles, líquidos inflamables, gas comprimido. | Par exemple : batteries au lithium, aérosols, liquides inflammables, gaz comprimé. |
| `customs:sampleData` | Sample data | Datos de ejemplo | Données d'exemple |
| `collection:zoneNote` | Times are local to {place} ({zone}). | Horas locales de {place} ({zone}). | Heures locales de {place} ({zone}). |
| `collection:window.minLength` | Choose a window of at least 2 hours. | Elige una franja de al menos 2 horas. | Choisissez un créneau d'au moins 2 heures. |
| `booking:review.verifyBanner` | Verify your email before you pay. We sent a link to {email}. | Verifica tu correo electrónico antes de pagar. Hemos enviado un enlace a {email}. | Vérifiez votre adresse e-mail avant de payer. Nous avons envoyé un lien à {email}. |
| `booking:review.continue` | Continue to payment | Continuar al pago | Passer au paiement |
| `checkout:testMode.badge` | Test mode | Modo de prueba | Mode test |
| `checkout:testMode.notice` | Test mode: no real money is taken. Use a test card. | Modo de prueba: no se cobra dinero real. Usa una tarjeta de prueba. | Mode test : aucun paiement réel n'est effectué. Utilisez une carte de test. |
| `checkout:amountToCharge` | Amount to be charged | Importe que se cobrará | Montant qui sera débité |
| `checkout:pay.action` | Pay {amount} | Pagar {amount} | Payer {amount} |
| `confirmation:progress.title` | Booking your shipment | Reservando tu envío | Réservation de votre envoi |
| `confirmation:title` | Your shipment is booked | Tu envío está reservado | Votre envoi est réservé |
| `confirmation:notCharged` | You haven't been charged. The hold on your card has been released. | No se te ha cobrado nada. Se ha liberado la retención en tu tarjeta. | Aucun montant n'a été débité. La réservation de fonds sur votre carte a été levée. |

### 4.5 Tracking, account and admin

| Key | en | es | fr |
|---|---|---|---|
| `tracking:title` | Track a shipment | Seguir un envío | Suivre un envoi |
| `tracking:field.label` | Tracking or order number | Número de seguimiento o de pedido | Numéro de suivi ou de commande |
| `shipments:empty.title` | No shipments yet | Todavía no hay envíos | Aucun envoi pour le moment |
| `shipments:count` | {count, plural, one {# shipment shown} other {# shipments shown}} | {count, plural, one {# envío mostrado} many {# de envíos mostrados} other {# envíos mostrados}} | {count, plural, one {# envoi affiché} many {# d'envois affichés} other {# envois affichés}} |
| `documents:preparing` | Documents are being prepared… | Estamos preparando los documentos… | Préparation des documents en cours… |
| `audit:title` | Audit log | Registro de auditoría | Journal d'audit |
| `audit:readOnly` | Read-only. Entries can't be changed. | Solo lectura. Las entradas no se pueden modificar. | Lecture seule. Les entrées ne peuvent pas être modifiées. |
| `audit:chain.ok` | Chain verified: {datetime} | Cadena verificada: {datetime} | Chaîne vérifiée : {datetime} |
| `audit:redacted` | [REDACTED] | [OCULTO] | [MASQUÉ] |

### 4.6 Error codes (selection; every catalogue code needs a key in all three locales)

| Key | en | es | fr |
|---|---|---|---|
| `errors:INVALID_CREDENTIALS` | Email or password is incorrect. | El correo electrónico o la contraseña no son correctos. | L'adresse e-mail ou le mot de passe est incorrect. |
| `errors:ACCOUNT_DELAYED` | Too many attempts. You can try again in {seconds, plural, one {# second} other {# seconds}}. | Demasiados intentos. Puedes volver a intentarlo en {seconds, plural, one {# segundo} other {# segundos}}. | Trop de tentatives. Vous pourrez réessayer dans {seconds, plural, one {# seconde} other {# secondes}}. |
| `errors:ACCOUNT_LOCKED` | For your security, sign-in is paused until {time}. | Por tu seguridad, el inicio de sesión está bloqueado hasta las {time}. | Pour votre sécurité, la connexion est suspendue jusqu'à {time}. |
| `errors:MFA_INVALID` | That code didn't work. Enter the current code from your app. | Ese código no es válido. Introduce el código actual de tu aplicación. | Ce code ne fonctionne pas. Saisissez le code actuel de votre application. |
| `errors:MFA_LOCKED` | Too many incorrect codes. You can try again at {time}. | Demasiados códigos incorrectos. Puedes volver a intentarlo a las {time}. | Trop de codes incorrects. Vous pourrez réessayer à {time}. |
| `errors:RATE_LIMITED` | Too many requests. Try again in {seconds, plural, one {# second} other {# seconds}}. | Demasiadas solicitudes. Vuelve a intentarlo en {seconds, plural, one {# segundo} other {# segundos}}. | Trop de demandes. Réessayez dans {seconds, plural, one {# seconde} other {# secondes}}. |
| `errors:AUTHZ_DENIED` | You don't have permission to do that. | No tienes permiso para hacer esto. | Vous n'avez pas l'autorisation d'effectuer cette action. |
| `errors:NOT_FOUND` | We couldn't find what you're looking for. | No hemos encontrado lo que buscas. | Nous n'avons pas trouvé ce que vous cherchez. |
| `errors:CONCURRENCY_CONFLICT` | This was changed in another tab or device. We've loaded the latest version. | Se ha modificado en otra pestaña o dispositivo. Hemos cargado la versión más reciente. | Cet élément a été modifié dans un autre onglet ou sur un autre appareil. Nous avons chargé la dernière version. |
| `errors:INTERNAL_ERROR` | Something went wrong on our side. Try again. | Algo ha fallado por nuestra parte. Vuelve a intentarlo. | Un problème est survenu de notre côté. Réessayez. |
| `errors:AUDIT_UNAVAILABLE` | This is temporarily unavailable. Try again in a moment. | No está disponible temporalmente. Vuelve a intentarlo en un momento. | Indisponible pour le moment. Réessayez dans un instant. |
| `errors:QUOTE_EXPIRED` | These prices have expired. Get new prices to continue. | Estos precios han caducado. Obtén precios nuevos para continuar. | Ces tarifs ont expiré. Obtenez de nouveaux tarifs pour continuer. |
| `errors:QUOTE_ALREADY_CLAIMED` | This quote is linked to another account. | Este presupuesto está vinculado a otra cuenta. | Ce devis est associé à un autre compte. |
| `errors:EMAIL_NOT_VERIFIED` | Verify your email address before you pay. | Verifica tu correo electrónico antes de pagar. | Vérifiez votre adresse e-mail avant de payer. |
| `errors:ITEM_PROHIBITED` | This can't be sent to this destination: {item}. | No se puede enviar a este destino: {item}. | Envoi interdit vers cette destination : {item}. |
| `errors:CARD_DECLINED` | Your bank declined this card. Try another card or contact your bank. | Tu banco ha rechazado esta tarjeta. Prueba con otra tarjeta o ponte en contacto con tu banco. | Votre banque a refusé cette carte. Essayez une autre carte ou contactez votre banque. |
| `errors:AUTHENTICATION_FAILED` | Your bank couldn't confirm this payment. Try again or use another card. | Tu banco no ha podido confirmar este pago. Vuelve a intentarlo o usa otra tarjeta. | Votre banque n'a pas pu confirmer ce paiement. Réessayez ou utilisez une autre carte. |
| `errors:GATEWAY_UNAVAILABLE` | We can't reach the payment service right now. You haven't been charged. | Ahora mismo no podemos conectar con el servicio de pago. No se te ha cobrado nada. | Le service de paiement est injoignable pour le moment. Aucun montant n'a été débité. |
| `errors:PICKUP_DATE_INVALID` | This date isn't available for pickup. Choose another date. | Esta fecha no está disponible para la recogida. Elige otra fecha. | Cette date n'est pas disponible pour l'enlèvement. Choisissez une autre date. |
| `errors:TRACKING_NOT_FOUND` | We couldn't find that number. Check it and try again. | No hemos encontrado ese número. Compruébalo y vuelve a intentarlo. | Nous n'avons pas trouvé ce numéro. Vérifiez-le et réessayez. |
| `errors:REAUTH_REQUIRED` | Confirm it's you to continue. | Confirma que eres tú para continuar. | Confirmez votre identité pour continuer. |
| `errors:SESSION_EXPIRED` | Your session has ended. Sign in again to continue. | Tu sesión ha finalizado. Vuelve a iniciar sesión para continuar. | Votre session a pris fin. Reconnectez-vous pour continuer. |
| `errors:MFA_ENROLMENT_CODE_REQUIRED` | That code didn't work or has expired. Check the latest email, or send a new code. | Ese código no es válido o ha caducado. Revisa el correo más reciente o pide un código nuevo. | Ce code ne fonctionne pas ou a expiré. Consultez le dernier e-mail ou demandez un nouveau code. |
| `validation:PASSWORD_POLICY` | Choose a stronger password: 12 to 128 characters and not a commonly used password. | Elige una contraseña más segura: de 12 a 128 caracteres y que no sea de uso común. | Choisissez un mot de passe plus sûr : 12 à 128 caractères, et pas un mot de passe courant. |
| `errors:UNKNOWN` (fallback) | Something went wrong. Try again. | Algo ha fallado. Vuelve a intentarlo. | Un problème est survenu. Réessayez. |

Every code in DR-A26 and every Part B domain code (QUOTE_*, PICKUP_*, CUSTOMS_*, COMMODITY_CODE_FORMAT, ORDER_CURRENCY_MISMATCH, COUPON_*, PAYMENT_*, CARD_DATA_NOT_ACCEPTED, DG_ATTESTATION_REQUIRED, SHIPMENT_NOT_CANCELLABLE, ILLEGAL_STATE_TRANSITION, ADDRESS_COUNTRY_MISMATCH, COVER_VALUE_EXCEEDS_MAXIMUM, INVALID_CURSOR, RANGE_TOO_LARGE, DOWNLOAD_EXPIRED, PICKUP_UNAVAILABLE and so on) must have an `errors:` key in all three locales. A CI test derives the list from the `packages/shared` catalogue (US-036, US-115).

### 4.7 Canonical statuses (`status:shipment.*`; tracking uses the same words where shared)

| Code | en | es | fr |
|---|---|---|---|
| DRAFT | Draft | Borrador | Brouillon |
| QUOTED | Priced | Con precio | Tarif établi |
| PENDING_PAYMENT | Awaiting payment | Pendiente de pago | En attente de paiement |
| PAID | Payment authorised | Pago autorizado | Paiement autorisé |
| BOOKING | Booking with carrier | Reservando con el transportista | Réservation en cours |
| BOOKED | Booked | Reservado | Réservé |
| LABEL_READY | Label ready | Etiqueta lista | Étiquette prête |
| PICKUP_SCHEDULED | Pickup scheduled | Recogida programada | Enlèvement programmé |
| DROPPED_OFF | Dropped off | Entregado en el punto | Déposé en point relais |
| IN_TRANSIT | In transit | En tránsito | En transit |
| CUSTOMS_HOLD | Held at customs | Retenido en aduanas | Retenu en douane |
| OUT_FOR_DELIVERY | Out for delivery | En reparto | En cours de livraison |
| DELIVERED | Delivered | Entregado | Livré |
| EXCEPTION | Needs attention | Requiere atención | Intervention requise |
| RETURNED_TO_SENDER | Returned to sender | Devuelto al remitente | Retourné à l'expéditeur |
| CANCELLED | Cancelled | Cancelado | Annulé |
| VOIDED | Label cancelled | Etiqueta anulada | Étiquette annulée |
| REFUNDED | Refunded | Reembolsado | Remboursé |

The es and fr OUT_FOR_DELIVERY values match US-248's acceptance example.

### 4.8 Glossary (use consistently)

| Concept | en | es | fr |
|---|---|---|---|
| shipment | shipment | envío | envoi |
| parcel / document | parcel / document | paquete / documento | colis / document |
| quote (entity) | quote; UI says "prices" when listing options | presupuesto; "precios" | devis ; « tarifs » |
| carrier | carrier | transportista | transporteur |
| pickup / drop-off | pickup / drop-off | recogida / entrega en punto | enlèvement / dépôt en point relais |
| label | shipping label | etiqueta de envío | étiquette d'expédition |
| tracking number | tracking number | número de seguimiento | numéro de suivi |
| order number | order number | número de pedido | numéro de commande |
| customs / commodity code | customs / commodity code (HS) | aduanas / código arancelario (SA) | douane / code SH |
| billable / volumetric weight | billable / volumetric weight | peso facturable / volumétrico | poids facturable / volumétrique |
| protection cover | cover | cobertura | couverture |
| two-step verification | two-step verification | verificación en dos pasos | validation en deux étapes |
| recovery code | recovery code | código de recuperación | code de récupération |
| audit log | audit log | registro de auditoría | journal d'audit |
| session (signed-in device) | session; UI says "device" in lists | sesión; "dispositivo" | session ; « appareil » |
| security code (card) | security code (CVC) | código de seguridad (CVC) | cryptogramme visuel (CVC) |
| confirm it's you (re-authentication) | confirm it's you | confirmar que eres tú | confirmer votre identité |

### 4.9 Sessions list (`sessions` namespace, US-027; W13 §1, W16 §4)

| Key | en | es | fr |
|---|---|---|---|
| `sessions:title` | Where you're signed in | Dónde has iniciado sesión | Appareils connectés |
| `sessions:adminTitle` | My sessions | Mis sesiones | Mes sessions |
| `sessions:intro` | These are the devices signed in to your account. Sign out any you don't recognise. | Estos son los dispositivos con sesión iniciada en tu cuenta. Cierra la sesión en los que no reconozcas. | Voici les appareils connectés à votre compte. Fermez la session sur ceux que vous ne reconnaissez pas. |
| `sessions:caption` | Devices signed in to your account | Dispositivos con sesión iniciada en tu cuenta | Appareils connectés à votre compte |
| `sessions:col.device` | Device | Dispositivo | Appareil |
| `sessions:col.ipRange` | IP address range | Rango de direcciones IP | Plage d'adresses IP |
| `sessions:col.signedIn` | Signed in | Inicio de sesión | Connexion |
| `sessions:col.lastActive` | Last active | Última actividad | Dernière activité |
| `sessions:device` | {browser} on {os} | {browser} en {os} | {browser} sur {os} |
| `sessions:unknownDevice` | Unknown device | Dispositivo desconocido | Appareil inconnu |
| `sessions:thisDevice` | This device | Este dispositivo | Cet appareil |
| `sessions:signOut.action` | Sign out | Cerrar sesión | Se déconnecter |
| `sessions:signOut.aria` | Sign out of {device} | Cerrar sesión en {device} | Fermer la session sur {device} |
| `sessions:signOut.ariaCurrent` | Sign out of this device | Cerrar sesión en este dispositivo | Fermer la session sur cet appareil |
| `sessions:signOut.done` | Signed out of {device}. | Sesión cerrada en {device}. | Session fermée sur {device}. |
| `sessions:signOut.alreadyEnded` | That session had already ended. | Esa sesión ya había finalizado. | Cette session avait déjà pris fin. |
| `sessions:others.action` | Sign out of all other devices | Cerrar sesión en todos los demás dispositivos | Se déconnecter de tous les autres appareils |
| `sessions:others.confirm.title` | Sign out of all other devices? | ¿Cerrar sesión en todos los demás dispositivos? | Se déconnecter de tous les autres appareils ? |
| `sessions:others.confirm.body` | You'll stay signed in on this device. | Seguirás con la sesión iniciada en este dispositivo. | Votre session restera ouverte sur cet appareil. |
| `sessions:others.confirm.action` | Sign out other devices | Cerrar sesión en los demás | Déconnecter les autres appareils |
| `sessions:others.done` | {count, plural, one {Signed out of # other device.} other {Signed out of # other devices.}} | {count, plural, one {Sesión cerrada en # dispositivo más.} many {Sesión cerrada en # de dispositivos más.} other {Sesión cerrada en # dispositivos más.}} | {count, plural, one {Session fermée sur # autre appareil.} many {Session fermée sur # d'autres appareils.} other {Session fermée sur # autres appareils.}} |
| `sessions:onlyDevice` | This is the only device signed in. | Este es el único dispositivo con la sesión iniciada. | Aucun autre appareil n'est connecté. |
| `sessions:error.load` | We couldn't load your sessions. | No hemos podido cargar tus sesiones. | Impossible de charger vos sessions. |
| `sessions:loading` (a11y) | Loading your sessions | Cargando tus sesiones | Chargement de vos sessions |

`{browser}` and `{os}` are product names from the user-agent parser (not translated). `{device}` is the pre-formatted `sessions:device` string or `sessions:unknownDevice`.

### 4.10 Re-authentication dialog (`reauth` namespace, US-291; W03 §8)

| Key | en | es | fr |
|---|---|---|---|
| `reauth:title` | Confirm it's you | Confirma que eres tú | Confirmez votre identité |
| `reauth:instruction.password` | Enter your password to continue. | Introduce tu contraseña para continuar. | Saisissez votre mot de passe pour continuer. |
| `reauth:instruction.totp` | Enter the 6-digit code from your authenticator app to continue. | Introduce el código de 6 dígitos de tu aplicación de autenticación para continuar. | Saisissez le code à 6 chiffres de votre application d'authentification pour continuer. |
| `reauth:stale` | {hours, plural, one {It's been more than # hour since you last confirmed it's you.} other {It's been more than # hours since you last confirmed it's you.}} | {hours, plural, one {Ha pasado más de # hora desde la última vez que confirmaste que eras tú.} many {Han pasado más de # de horas desde la última vez que confirmaste que eras tú.} other {Han pasado más de # horas desde la última vez que confirmaste que eras tú.}} | {hours, plural, one {Plus de # heure s'est écoulée depuis votre dernière confirmation d'identité.} many {Plus de # d'heures se sont écoulées depuis votre dernière confirmation d'identité.} other {Plus de # heures se sont écoulées depuis votre dernière confirmation d'identité.}} |
| `reauth:purpose.auth_password_change` | You're changing your password. | Vas a cambiar tu contraseña. | Vous êtes sur le point de modifier votre mot de passe. |
| `reauth:purpose.mfa_totp_disable` | You're turning off two-step verification. | Vas a desactivar la verificación en dos pasos. | Vous êtes sur le point de désactiver la validation en deux étapes. |
| `reauth:purpose.mfa_recovery_codes_regenerate` | You're generating new recovery codes. Your old codes will stop working. | Vas a generar códigos de recuperación nuevos. Los anteriores dejarán de funcionar. | Vous êtes sur le point de générer de nouveaux codes de récupération. Les anciens codes ne fonctionneront plus. |
| `reauth:purpose.privacy_delete` | You're deleting your account. | Vas a eliminar tu cuenta. | Vous êtes sur le point de supprimer votre compte. |
| `reauth:purpose.privacy_export` | You're downloading a copy of your personal data. | Vas a descargar una copia de tus datos personales. | Vous êtes sur le point de télécharger une copie de vos données personnelles. |
| `reauth:purpose.payment_method_manage` | You're changing your saved cards. | Vas a modificar tus tarjetas guardadas. | Vous êtes sur le point de modifier vos cartes enregistrées. |
| `reauth:purpose.org_member_manage` | You're changing who has access to your organisation. | Vas a cambiar quién tiene acceso a tu organización. | Vous êtes sur le point de modifier les accès à votre organisation. |
| `reauth:password.label` | Password | Contraseña | Mot de passe |
| `reauth:code.label` | Code from your authenticator app | Código de tu aplicación de autenticación | Code de votre application d'authentification |
| `reauth:passwordInvalid` | That password is incorrect. Try again. | Esa contraseña no es correcta. Vuelve a intentarlo. | Ce mot de passe est incorrect. Réessayez. |
| `reauth:expired` | That took too long. Confirm it's you again. | Ha pasado demasiado tiempo. Vuelve a confirmar que eres tú. | Le délai est dépassé. Confirmez à nouveau votre identité. |
| `reauth:error` | We couldn't check this right now. Try again. | Ahora mismo no podemos comprobarlo. Vuelve a intentarlo. | Vérification impossible pour le moment. Réessayez. |
| `reauth:continue` | Continue | Continuar | Continuer |
| `reauth:cantUseApp` | Can't use your authenticator app? | ¿No puedes usar tu aplicación de autenticación? | Vous ne pouvez pas utiliser votre application d'authentification ? |

### 4.11 Admin idle timeout (`shell` namespace in `apps/admin`, US-033; W00 §2.1) and sign-in notices

| Key | en | es | fr |
|---|---|---|---|
| `shell:idle.title` | Are you still there? | ¿Sigues ahí? | Êtes-vous toujours là ? |
| `shell:idle.body` | You haven't used the admin app for a while. For security, we'll sign you out at {time}. | Hace un rato que no usas la aplicación de administración. Por seguridad, cerraremos tu sesión a las {time}. | Vous n'avez pas utilisé l'application d'administration depuis un moment. Pour votre sécurité, votre session sera fermée à {time}. |
| `shell:idle.timeLeft` | Time left: {remaining} | Tiempo restante: {remaining} | Temps restant : {remaining} |
| `shell:idle.extend` | Extend session | Ampliar sesión | Prolonger la session |
| `shell:idle.signOut` | Sign out | Cerrar sesión | Se déconnecter |
| `shell:idle.oneMinuteLeft` (a11y) | 1 minute left before you're signed out. | Queda 1 minuto para que se cierre tu sesión. | Il reste 1 minute avant la fermeture de votre session. |
| `shell:idle.extended` (a11y) | Session extended. | Sesión ampliada. | Session prolongée. |
| `shell:idle.extendFailed` | We couldn't extend your session. Check your connection and try again. | No hemos podido ampliar tu sesión. Comprueba tu conexión y vuelve a intentarlo. | Impossible de prolonger votre session. Vérifiez votre connexion et réessayez. |
| `auth:signIn.signedOutIdle` | You were signed out for inactivity. Sign in again to continue. | Se ha cerrado tu sesión por inactividad. Vuelve a iniciar sesión para continuar. | Votre session a pris fin pour cause d'inactivité. Reconnectez-vous pour continuer. |
| `auth:signIn.sessionEnded` (admin) | Your session ended. Sign in again. | Tu sesión ha finalizado. Vuelve a iniciar sesión. | Votre session a pris fin. Reconnectez-vous. |
| `auth:signIn.signedOutSelf` (admin) | You signed out. | Has cerrado sesión. | Votre session est fermée. |
| `auth:enrolCode.title` (admin) | Confirm your email | Confirma tu correo electrónico | Confirmez votre adresse e-mail |
| `auth:enrolCode.body` (admin) | To keep staff accounts safe, we've sent a 6-digit code to {email}. Enter it to set up two-step verification. The code expires in 10 minutes. | Para proteger las cuentas del personal, hemos enviado un código de 6 dígitos a {email}. Introdúcelo para configurar la verificación en dos pasos. El código caduca en 10 minutos. | Pour protéger les comptes du personnel, nous avons envoyé un code à 6 chiffres à {email}. Saisissez-le pour configurer la validation en deux étapes. Le code expire dans 10 minutes. |
| `auth:enrolCode.label` (admin) | Code from the email | Código del correo electrónico | Code reçu par e-mail |
| `auth:enrolCode.resend` (admin) | Send a new code | Enviar un código nuevo | Envoyer un nouveau code |

`{time}` is formatted by the shared time helper in the viewer's zone; `{remaining}` is a pre-formatted `m:ss` duration from the shared helper; `{email}` is the masked address from the server. The "Extend session" label follows the US-033 acceptance criterion (ADR-0026 am. 8 calls the action "Stay signed in"; D-UX-032).

### 4.12 CVC re-collection (`checkout` namespace, US-217 Should; W08 §5)

| Key | en | es | fr |
|---|---|---|---|
| `checkout:cvc.notice` | For your security, enter the security code for {card}. | Por tu seguridad, introduce el código de seguridad de {card}. | Pour votre sécurité, saisissez le cryptogramme visuel de la carte {card}. |
| `checkout:cvc.label` | Security code (CVC) | Código de seguridad (CVC) | Cryptogramme visuel (CVC) |
| `checkout:cvc.hint` | The 3 digits on the back of your card. | Los 3 dígitos del reverso de tu tarjeta. | Les 3 chiffres au dos de votre carte. |
| `checkout:cvc.hintAmex` | The 4 digits on the front of your card. | Los 4 dígitos del anverso de tu tarjeta. | Les 4 chiffres au recto de votre carte. |
| `checkout:cvc.required` | Enter the security code. | Introduce el código de seguridad. | Saisissez le cryptogramme visuel. |
| `checkout:cvc.incomplete` | The security code is incomplete. Enter {digits} digits. | El código de seguridad está incompleto. Introduce {digits} dígitos. | Le cryptogramme visuel est incomplet. Saisissez {digits} chiffres. |
| `checkout:cvc.loadFailed` | We couldn't load the security code field. Try again, or use a new card. | No hemos podido cargar el campo del código de seguridad. Vuelve a intentarlo o usa otra tarjeta. | Impossible de charger le champ du cryptogramme visuel. Réessayez ou utilisez une autre carte. |
| `checkout:cvc.failed.title` | We couldn't verify this card's security code. | No hemos podido verificar el código de seguridad de esta tarjeta. | Nous n'avons pas pu vérifier le cryptogramme visuel de cette carte. |
| `checkout:cvc.failed.body` | You haven't been charged. Check the code and try again, use a new card, or confirm it's you. | No se te ha cobrado nada. Revisa el código y vuelve a intentarlo, usa otra tarjeta o confirma que eres tú. | Aucun montant n'a été débité. Vérifiez le code et réessayez, utilisez une autre carte ou confirmez votre identité. |
| `checkout:cvc.failed.bodyNoReauth` | You haven't been charged. Check the code and try again, or use a new card. | No se te ha cobrado nada. Revisa el código y vuelve a intentarlo, o usa otra tarjeta. | Aucun montant n'a été débité. Vérifiez le code et réessayez, ou utilisez une autre carte. |
| `checkout:cvc.failed.retry` | Enter the code again | Volver a introducir el código | Saisir à nouveau le code |
| `checkout:cvc.failed.newCard` | Use a new card | Usar otra tarjeta | Utiliser une autre carte |
| `checkout:cvc.failed.reauth` | Confirm it's you | Confirmar que eres tú | Confirmer votre identité |
| `a11y:cvcFrame` | Secure security code input frame | Marco seguro para introducir el código de seguridad | Cadre sécurisé de saisie du cryptogramme visuel |

`{card}` is the pre-formatted brand and last four ("Visa •••• 4242"); `{digits}` is 3 or 4 (always the `other` plural form in all three locales, so no plural select is needed). `bodyNoReauth` is used while the "Confirm it's you" action is hidden (README §5 item 12).

### 4.13 E-mail additions (v1.1)

| Key | en | es | fr |
|---|---|---|---|
| `email:EMAIL_VERIFICATION.unverifiedExpiry` | {days, plural, one {If you don't confirm within # day, this account is removed and the address can be used to register again.} other {If you don't confirm within # days, this account is removed and the address can be used to register again.}} | {days, plural, one {Si no confirmas en # día, esta cuenta se eliminará y la dirección podrá volver a usarse para registrarse.} other {Si no confirmas en # días, esta cuenta se eliminará y la dirección podrá volver a usarse para registrarse.}} | {days, plural, one {Sans confirmation sous # jour, ce compte sera supprimé et l'adresse pourra servir à une nouvelle inscription.} other {Sans confirmation sous # jours, ce compte sera supprimé et l'adresse pourra servir à une nouvelle inscription.}} |
| `email:SECURITY_NOTICE.cta` | Review where you're signed in | Revisa dónde has iniciado sesión | Vérifiez les appareils connectés |
| `email:BOOKING_CONFIRMATION.invoiceLink` | Download your customs invoice from your shipment page. | Descarga tu factura de aduanas desde la página del envío. | Téléchargez votre facture douanière depuis la page de l'envoi. |

`{days}` comes from `AUTH_UNVERIFIED_TTL` (never a literal); the configured value is small and bounded, so `many` is not needed.

## 5. Locale-aware formatting rules (US-116, NFR-I18N-004)

All formatting goes through shared helpers in `packages/shared` and `packages/ui`. `toFixed`, `toLocaleString` and manual date strings outside the helpers fail lint.

### 5.1 Formatting locale

- The **UI language** is en, es or fr (DR-A18). The **formatting locale** is a BCP 47 tag `{language}-{region}`. The region comes from (1) the user's profile country, (2) the first browser language with the same language subtag, or (3) the default region per language: en→US, es→ES, fr→FR. For example, an en user in India formats as `en-IN` (lakh grouping) and a French Canadian as `fr-CA`.
- **Grouping:** helpers pass `useGrouping: 'always'` so four-digit numbers group in Spanish ("1.234,50"), as US-116 expects. CLDR's Spanish default would print "1234,50". Supported in current evergreen browsers. Recorded in D-UX-028.

### 5.2 Rules by data type

| Data | Rule | Example (en-US / es-ES / fr-FR) |
|---|---|---|
| Numbers | `Intl.NumberFormat(locale, {useGrouping: 'always'})` | 1,234.5 / 1.234,5 / 1 234,5 (U+202F narrow no-break space) |
| Money | Integer minor units + ISO 4217 → `Intl.NumberFormat(locale, {style: 'currency', currency})`; fraction digits from the currency (INR 2, JPY 0). The `code` display is used at checkout and on FX lines. Approximate conversions are prefixed "approx." | $1,234.56 / 1.234,56 US$ / 1 234,56 $US |
| Charged amount | Always the sell currency with code: "USD 65.00". Never the display currency. | USD 65.00 / 65,00 USD / 65,00 USD |
| Instants (timestamps) | Viewer's IANA zone (profile, else browser). `dateStyle: 'medium'`, `timeStyle: 'short'` + `timeZoneName: 'short'`. Month names avoid day/month ambiguity. Audit detail adds UTC. | Nov 12, 2026, 2:30 PM CET / 12 nov 2026, 14:30 CET / 12 nov. 2026, 14:30 UTC+1 (the zone label follows Intl; CLDR may give an offset where no abbreviation exists, which is acceptable) |
| Date-only (pickup date, holiday) | Never converted. Formatted with `timeZone: 'UTC'` from the stored date. Weekday included in pickers. Location zone named beside time windows. | Tue, Nov 17 / mar, 17 nov / mar. 17 nov. |
| Time windows | Local times of the pickup location + zone abbreviation: "13:00–17:00 EST". 24 h or 12 h follows the formatting locale (`hourCycle` from Intl). En dash range via `Intl.DateTimeFormat.formatRange` where supported. | 1:00 – 5:00 PM EST / 13:00–17:00 EST / 13:00–17:00 EST |
| Relative time | `Intl.RelativeTimeFormat` only in sessions and audit lists, with the absolute time in the tooltip and accessible name | 3 hours ago / hace 3 horas / il y a 3 heures |
| Durations (countdowns) | `Intl.NumberFormat` with `style: 'unit'` (`hour`, `minute`, `unitDisplay: 'narrow'`) composed through an ICU key `common:duration.hoursMinutes` | 2h 14m / 2 h 14 min / 2 h 14 min |
| Weight | Canonical grams → the user's unit system. `style: 'unit'`, `unit: 'kilogram'` or `'pound'`, `unitDisplay: 'short'`, max 2 fraction digits (display) / 1 (input) | 4.41 lb / 2 kg / 2 kg |
| Dimensions | Canonical mm → cm or in; the pattern key `units:dimensions` = "{l} × {w} × {h} {unit}" with the unit symbol from Intl | 11.8 × 7.9 × 3.9 in / 30 × 20 × 10 cm |
| Distance (drop-off) | km for metric, mi for imperial, `style: 'unit'` | 0.7 mi / 1,2 km / 1,2 km |
| Countries and languages | `Intl.DisplayNames(locale, {type: 'region' / 'language'})`. Sort with `Intl.Collator(locale)`. Language switcher uses endonyms. | India / India / Inde |
| Addresses | **The destination country decides the layout, not the UI language** (US-119). Field order, labels (ZIP code, PIN code, postcode, postal code; state, province, county) and required flags come from reference data. The rendered block uses the country's format template (for example US "{name}\n{org}\n{lines}\n{city}, {state} {zip}"; IN "{lines}\n{city} {pin}\n{state}"; GB "{lines}\n{city}\n{postcode}"). The country name is added for cross-border display, in the UI language. | — |
| Names | A single "Full name" field (no first/last split), because naming conventions vary and carriers need one contact name. Shown as entered. | — |
| Phone numbers | Stored as E.164; displayed as entered by the user (no formatting library in M1), with the "+" kept. | +1 415 555 0100 |
| Tracking and order numbers, hashes, codes | Monospace, never localised digits, never re-cased | US-000000123 |
| Percentages | `style: 'percent'` | 12.5% / 12,5 % / 12,5 % |
| Lists ("Fuel, remote area") | `Intl.ListFormat(locale, {type: 'conjunction'})` | Fuel and remote area / Combustible y zona remota / Carburant et zone éloignée |

## 6. Microcopy patterns

| Pattern | Rule | Example |
|---|---|---|
| Error message | What happened + how to fix, ≤ 2 sentences, no code numbers (a reference ID only in error states) | "Enter a PIN code with 6 digits, for example 400001." |
| Empty state | What this place is for + one next step | "No drafts. Bookings you start but don't finish are saved here." [Get a quote] |
| Confirmation dialog | Title states the action as a question. Body states the consequence. Buttons name the actions. | "Delete this draft?" / "You can't undo this." / [Cancel] [Delete draft] |
| Destructive or signed action (M2 seam) | A typed reason is required (Select + note) and the consequences are listed | Cancel shipment dialog (W12) |
| Success | Past tense, specific, with what's next | "Pickup scheduled for Tue 17 Nov, 13:00–17:00 EST." |
| Toasts | ≤ 1 sentence. The same information is also on the page. | "Copied" |
| Loading | Name the thing: "Loading shipments" (accessible), "Getting quotes…" (button) | — |
| Unreviewed data | Honest and visible: "Sample data — not legal advice", "Draft, pending legal review", "Unreviewed" badge | — |
| Test environment | Unmissable but calm: "Test mode: no real money is taken." | — |
