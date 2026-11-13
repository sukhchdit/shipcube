/**
 * Typed, seeded entity factories (TEST-STRATEGY §10.1 rule 3; T-QA-03).
 *
 * `createFactories({ seed })` returns one factory per entity: user, organisation, membership, quote, shipment, order,
 * payment, document. Everything is synthetic and deterministic: the same seed (and worker id) yields the same ids,
 * names and amounts, and every e-mail ends in `@<run>.test.invalid` where `<run>` differs per seed, Jest worker and run
 * token, so parallel workers writing into a shared system never collide. No secret or credential is generated.
 *
 * The shapes below are the fields tests need today, not the persistence model: each module's own tasks tighten them
 * against its Prisma model when the tables land. Money is integer minor units plus an ISO currency (REQ-PRC), never a float.
 */
import { createRng, type Rng, runIdentity, type RunIdentityOptions } from './rng.js';

export type OrgRole = 'OWNER' | 'ADMIN' | 'SHIPPER' | 'FINANCE' | 'VIEWER';
export type Carrier = 'MOCK' | 'DHL' | 'FEDEX' | 'UPS';
export type ShipmentStatus = 'DRAFT' | 'BOOKED' | 'LABEL_READY' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
export type PaymentStatus = 'AUTHORISED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';

export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale: 'en' | 'es' | 'fr';
  readonly createdAt: Date;
}

export interface OrganisationRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
}

export interface MembershipRecord {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly role: OrgRole;
  readonly createdAt: Date;
}

export interface QuoteRecord {
  readonly id: string;
  readonly orgId: string;
  readonly origin: string;
  readonly destination: string;
  readonly weightGrams: number;
  readonly carrier: Carrier;
  readonly price: Money;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface ShipmentRecord {
  readonly id: string;
  readonly orgId: string;
  readonly quoteId: string;
  readonly status: ShipmentStatus;
  readonly trackingNumber: string;
  readonly createdAt: Date;
}

export interface OrderRecord {
  readonly id: string;
  readonly orgId: string;
  readonly shipmentId: string;
  readonly status: OrderStatus;
  readonly total: Money;
  readonly createdAt: Date;
}

export interface PaymentRecord {
  readonly id: string;
  readonly orgId: string;
  readonly orderId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  /** Mock gateway token (`mock_ok`, ...): never a real instrument. */
  readonly gatewayToken: string;
  readonly createdAt: Date;
}

export interface DocumentRecord {
  readonly id: string;
  readonly orgId: string;
  readonly shipmentId: string;
  readonly kind: 'LABEL' | 'COMMERCIAL_INVOICE' | 'CUSTOMS_DECLARATION';
  readonly contentType: 'application/pdf';
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

export interface FactoryOptions extends RunIdentityOptions {
  /** Creation instant stamped on every record (default a fixed instant, never the wall clock). */
  readonly now?: () => Date;
}

type Overrides<T> = Partial<T>;

export interface Factories {
  /** `<run>.test.invalid` (see rng.ts `runIdentity`). */
  readonly emailDomain: string;
  readonly run: string;
  user(overrides?: Overrides<UserRecord>): UserRecord;
  organisation(overrides?: Overrides<OrganisationRecord>): OrganisationRecord;
  membership(overrides?: Overrides<MembershipRecord>): MembershipRecord;
  quote(overrides?: Overrides<QuoteRecord>): QuoteRecord;
  shipment(overrides?: Overrides<ShipmentRecord>): ShipmentRecord;
  order(overrides?: Overrides<OrderRecord>): OrderRecord;
  payment(overrides?: Overrides<PaymentRecord>): PaymentRecord;
  document(overrides?: Overrides<DocumentRecord>): DocumentRecord;
}

const FIXED_CREATED_AT = '2026-01-15T12:00:00.000Z';
const FIRST_NAMES = ['Asha', 'Bruno', 'Chen', 'Dara', 'Elif', 'Farid', 'Gita', 'Hugo', 'Ines', 'Jonas'] as const;
const LAST_NAMES = ['Almeida', 'Banerjee', 'Castro', 'Dubois', 'Eriksen', 'Fontaine', 'Gupta', 'Haddad', 'Iyer', 'Jensen'] as const;
const COMPANIES = ['Northwind', 'Harbour', 'Lantern', 'Meridian', 'Quarry', 'Sable'] as const;
const COUNTRIES = ['US', 'IN', 'GB', 'DE', 'FR', 'ES'] as const;
const ROLES: readonly OrgRole[] = ['OWNER', 'ADMIN', 'SHIPPER', 'FINANCE', 'VIEWER'];
const CARRIERS: readonly Carrier[] = ['MOCK', 'DHL', 'FEDEX', 'UPS'];
const LOCALES = ['en', 'es', 'fr'] as const;

/** Each entity draws from its own forked stream, so adding a call to one factory never shifts another's data. */
export function createFactories(options: FactoryOptions): Factories {
  const identity = runIdentity(options);
  const now = options.now ?? ((): Date => new Date(FIXED_CREATED_AT));
  const streams = new Map<string, Rng>();
  const root = createRng(`${String(options.seed)}|${identity.run}`);
  const rng = (name: string): Rng => {
    let stream = streams.get(name);
    if (stream === undefined) {
      stream = root.fork(name);
      streams.set(name, stream);
    }
    return stream;
  };
  const counters = new Map<string, number>();
  const sequence = (name: string): number => {
    const value = (counters.get(name) ?? 0) + 1;
    counters.set(name, value);
    return value;
  };
  const money = (r: Rng, min: number, max: number): Money => ({ amountMinor: r.int(min, max), currency: 'USD' });

  return {
    run: identity.run,
    emailDomain: identity.emailDomain,
    user(overrides = {}) {
      const r = rng('user');
      const n = sequence('user');
      const first = r.pick(FIRST_NAMES);
      const last = r.pick(LAST_NAMES);
      return {
        id: r.uuid(),
        email: `user-${n}@${identity.emailDomain}`,
        displayName: `${first} ${last}`,
        locale: r.pick(LOCALES),
        createdAt: now(),
        ...overrides,
      };
    },
    organisation(overrides = {}) {
      const r = rng('organisation');
      const n = sequence('organisation');
      const company = r.pick(COMPANIES);
      return {
        id: r.uuid(),
        name: `${company} Logistics ${n}`,
        slug: `${company.toLowerCase()}-${identity.run}-${n}`,
        createdAt: now(),
        ...overrides,
      };
    },
    membership(overrides = {}) {
      const r = rng('membership');
      return { id: r.uuid(), orgId: r.uuid(), userId: r.uuid(), role: r.pick(ROLES), createdAt: now(), ...overrides };
    },
    quote(overrides = {}) {
      const r = rng('quote');
      const origin = r.pick(COUNTRIES);
      const destination = r.pick(COUNTRIES.filter((country) => country !== origin));
      const createdAt = now();
      return {
        id: r.uuid(),
        orgId: r.uuid(),
        origin,
        destination,
        weightGrams: r.int(100, 30_000),
        carrier: r.pick(CARRIERS),
        price: money(r, 1_500, 90_000),
        expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
        createdAt,
        ...overrides,
      };
    },
    shipment(overrides = {}) {
      const r = rng('shipment');
      return {
        id: r.uuid(),
        orgId: r.uuid(),
        quoteId: r.uuid(),
        status: 'DRAFT',
        trackingNumber: `MOCK${r.int(0, 9_999_999_999).toString().padStart(10, '0')}`,
        createdAt: now(),
        ...overrides,
      };
    },
    order(overrides = {}) {
      const r = rng('order');
      return {
        id: r.uuid(),
        orgId: r.uuid(),
        shipmentId: r.uuid(),
        status: 'PENDING_PAYMENT',
        total: money(r, 1_500, 90_000),
        createdAt: now(),
        ...overrides,
      };
    },
    payment(overrides = {}) {
      const r = rng('payment');
      return {
        id: r.uuid(),
        orgId: r.uuid(),
        orderId: r.uuid(),
        status: 'CAPTURED',
        amount: money(r, 1_500, 90_000),
        gatewayToken: 'mock_ok',
        createdAt: now(),
        ...overrides,
      };
    },
    document(overrides = {}) {
      const r = rng('document');
      return {
        id: r.uuid(),
        orgId: r.uuid(),
        shipmentId: r.uuid(),
        kind: 'LABEL',
        contentType: 'application/pdf',
        sizeBytes: r.int(10_000, 400_000),
        createdAt: now(),
        ...overrides,
      };
    },
  };
}
