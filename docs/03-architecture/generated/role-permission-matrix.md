<!-- GENERATED FILE: do not edit. Regenerate with `npm run authz:generate` (source: packages/authz). -->

# Role-permission matrix

Catalogue version: **1**. Generated from the permission catalogue (`packages/authz/src/permissions`) and the role seed (`packages/authz/src/roles.ts`), the single source of the seed migration (ADR-0008, REQ-RBAC-002). CI fails when this file differs from the generator output.

`Y` = granted. Flags: `operator-only` = never held by a customer or partner role (DR-A07); `reserved` = seam for a later milestone, held by Super Admin only; `signature-only` = webhook permission, held by no role.

## Operator roles

| Permission | Flags | OPERATOR_SUPER_ADMIN | OPERATOR_ADMIN | OPERATOR_OPERATIONS | OPERATOR_FINANCE | OPERATOR_SUPPORT | OPERATOR_SALES | OPERATOR_COMPLIANCE_AUDITOR | OPERATOR_CONTENT_MANAGER |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `quote:create` |  | Y |  |  |  |  |  |  |  |
| `quote:read` |  | Y |  |  |  |  |  |  |  |
| `quote:share` |  | Y |  |  |  |  |  |  |  |
| `quote:delete` |  | Y |  |  |  |  |  |  |  |
| `shipment:create` |  | Y |  |  |  |  |  |  |  |
| `shipment:read` |  | Y |  |  |  |  |  |  |  |
| `shipment:cancel` |  | Y |  |  |  |  |  |  |  |
| `shipment:create:on_behalf` | reserved | Y |  |  |  |  |  |  |  |
| `shipment:read:any_org` | operator-only, reserved | Y |  |  |  |  |  |  |  |
| `order:read` |  | Y |  |  |  |  |  |  |  |
| `customs:manage` |  | Y |  |  |  |  |  |  |  |
| `pickup:read` |  | Y |  |  |  |  |  |  |  |
| `pickup:schedule` |  | Y |  |  |  |  |  |  |  |
| `pickup:cancel` |  | Y |  |  |  |  |  |  |  |
| `tracking:read` |  | Y |  |  |  |  |  |  |  |
| `document:read` |  | Y |  |  |  |  |  |  |  |
| `document:download` |  | Y |  |  |  |  |  |  |  |
| `document:email` |  | Y |  |  |  |  |  |  |  |
| `payment:create` |  | Y |  |  |  |  |  |  |  |
| `payment:read` |  | Y |  |  |  |  |  |  |  |
| `payment_method:manage` |  | Y |  |  |  |  |  |  |  |
| `refund:approve` | reserved | Y |  |  |  |  |  |  |  |
| `webhook:stripe:receive` | signature-only |  |  |  |  |  |  |  |  |
| `webhook:mock_gateway:receive` | signature-only |  |  |  |  |  |  |  |  |
| `org:read` |  | Y | Y |  |  |  |  |  |  |
| `org:update` |  | Y |  |  |  |  |  |  |  |
| `org:member:invite` |  | Y |  |  |  |  |  |  |  |
| `org:member:manage` |  | Y |  |  |  |  |  |  |  |
| `org:read:any_org` | operator-only, reserved | Y |  |  |  |  |  |  |  |
| `address_book:read` |  | Y |  |  |  |  |  |  |  |
| `address_book:manage` |  | Y |  |  |  |  |  |  |  |
| `session:manage` | self-service | Y | Y | Y | Y | Y | Y | Y | Y |
| `notification:read` | self-service | Y | Y | Y | Y | Y | Y | Y | Y |
| `notification_pref:manage` | self-service | Y | Y | Y | Y | Y | Y | Y | Y |
| `privacy:export` |  | Y |  |  |  |  |  |  |  |
| `privacy:delete` |  | Y |  |  |  |  |  |  |  |
| `audit:read` | operator-only | Y |  |  |  |  |  | Y |  |
| `audit:export` | operator-only, reserved | Y |  |  |  |  |  |  |  |
| `featureflag:manage` | operator-only | Y | Y |  |  |  |  |  |  |
| `carrier:status:read` | operator-only | Y | Y | Y |  | Y |  | Y |  |

## Customer roles

| Permission | Flags | CUSTOMER_OWNER | CUSTOMER_ADMIN | CUSTOMER_SHIPPER | CUSTOMER_FINANCE | CUSTOMER_VIEWER |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| `quote:create` |  | Y | Y | Y |  |  |
| `quote:read` |  | Y | Y | Y |  | Y |
| `quote:share` |  | Y | Y | Y |  |  |
| `quote:delete` |  | Y | Y | Y |  |  |
| `shipment:create` |  | Y | Y | Y |  |  |
| `shipment:read` |  | Y | Y | Y | Y | Y |
| `shipment:cancel` |  | Y | Y | Y |  |  |
| `shipment:create:on_behalf` | reserved |  |  |  |  |  |
| `shipment:read:any_org` | operator-only, reserved |  |  |  |  |  |
| `order:read` |  | Y | Y | Y | Y | Y |
| `customs:manage` |  | Y | Y | Y |  |  |
| `pickup:read` |  | Y | Y | Y |  | Y |
| `pickup:schedule` |  | Y | Y | Y |  |  |
| `pickup:cancel` |  | Y | Y | Y |  |  |
| `tracking:read` |  | Y | Y | Y |  | Y |
| `document:read` |  | Y | Y | Y | Y | Y |
| `document:download` |  | Y | Y | Y | Y |  |
| `document:email` |  | Y | Y | Y |  |  |
| `payment:create` |  | Y | Y | Y |  |  |
| `payment:read` |  | Y | Y |  | Y |  |
| `payment_method:manage` |  | Y | Y |  |  |  |
| `refund:approve` | reserved |  |  |  |  |  |
| `webhook:stripe:receive` | signature-only |  |  |  |  |  |
| `webhook:mock_gateway:receive` | signature-only |  |  |  |  |  |
| `org:read` |  | Y | Y | Y |  | Y |
| `org:update` |  | Y | Y |  |  |  |
| `org:member:invite` |  | Y | Y |  |  |  |
| `org:member:manage` |  | Y | Y |  |  |  |
| `org:read:any_org` | operator-only, reserved |  |  |  |  |  |
| `address_book:read` |  | Y | Y | Y |  | Y |
| `address_book:manage` |  | Y | Y | Y |  |  |
| `session:manage` | self-service | Y | Y | Y | Y | Y |
| `notification:read` | self-service | Y | Y | Y | Y | Y |
| `notification_pref:manage` | self-service | Y | Y | Y | Y | Y |
| `privacy:export` |  | Y | Y | Y |  |  |
| `privacy:delete` |  | Y | Y | Y |  |  |
| `audit:read` | operator-only |  |  |  |  |  |
| `audit:export` | operator-only, reserved |  |  |  |  |  |
| `featureflag:manage` | operator-only |  |  |  |  |  |
| `carrier:status:read` | operator-only |  |  |  |  |  |

## Partner roles (data only in this run, REQ-RBAC-003)

| Permission | Flags | PARTNER_OWNER | PARTNER_DEVELOPER | PARTNER_OPERATIONS | PARTNER_FINANCE |
| --- | --- | :-: | :-: | :-: | :-: |
| `quote:create` |  |  |  |  |  |
| `quote:read` |  |  |  |  |  |
| `quote:share` |  |  |  |  |  |
| `quote:delete` |  |  |  |  |  |
| `shipment:create` |  |  |  |  |  |
| `shipment:read` |  |  |  |  |  |
| `shipment:cancel` |  |  |  |  |  |
| `shipment:create:on_behalf` | reserved |  |  |  |  |
| `shipment:read:any_org` | operator-only, reserved |  |  |  |  |
| `order:read` |  |  |  |  |  |
| `customs:manage` |  |  |  |  |  |
| `pickup:read` |  |  |  |  |  |
| `pickup:schedule` |  |  |  |  |  |
| `pickup:cancel` |  |  |  |  |  |
| `tracking:read` |  |  |  |  |  |
| `document:read` |  |  |  |  |  |
| `document:download` |  |  |  |  |  |
| `document:email` |  |  |  |  |  |
| `payment:create` |  |  |  |  |  |
| `payment:read` |  |  |  |  |  |
| `payment_method:manage` |  |  |  |  |  |
| `refund:approve` | reserved |  |  |  |  |
| `webhook:stripe:receive` | signature-only |  |  |  |  |
| `webhook:mock_gateway:receive` | signature-only |  |  |  |  |
| `org:read` |  | Y | Y | Y | Y |
| `org:update` |  | Y |  |  |  |
| `org:member:invite` |  | Y |  |  |  |
| `org:member:manage` |  | Y |  |  |  |
| `org:read:any_org` | operator-only, reserved |  |  |  |  |
| `address_book:read` |  |  |  |  |  |
| `address_book:manage` |  |  |  |  |  |
| `session:manage` | self-service | Y | Y | Y | Y |
| `notification:read` | self-service | Y | Y | Y | Y |
| `notification_pref:manage` | self-service | Y | Y | Y | Y |
| `privacy:export` |  |  |  |  |  |
| `privacy:delete` |  |  |  |  |  |
| `audit:read` | operator-only |  |  |  |  |
| `audit:export` | operator-only, reserved |  |  |  |  |
| `featureflag:manage` | operator-only |  |  |  |  |
| `carrier:status:read` | operator-only |  |  |  |  |

## Permissions per role

| Role | Scope | Name key | Permissions |
| --- | --- | --- | --: |
| OPERATOR_SUPER_ADMIN | OPERATOR | `roles.operator.super_admin` | 38 |
| OPERATOR_ADMIN | OPERATOR | `roles.operator.admin` | 6 |
| OPERATOR_OPERATIONS | OPERATOR | `roles.operator.operations` | 4 |
| OPERATOR_FINANCE | OPERATOR | `roles.operator.finance` | 3 |
| OPERATOR_SUPPORT | OPERATOR | `roles.operator.support` | 4 |
| OPERATOR_SALES | OPERATOR | `roles.operator.sales` | 3 |
| OPERATOR_COMPLIANCE_AUDITOR | OPERATOR | `roles.operator.compliance_auditor` | 5 |
| OPERATOR_CONTENT_MANAGER | OPERATOR | `roles.operator.content_manager` | 3 |
| CUSTOMER_OWNER | CUSTOMER | `roles.customer.owner` | 30 |
| CUSTOMER_ADMIN | CUSTOMER | `roles.customer.admin` | 30 |
| CUSTOMER_SHIPPER | CUSTOMER | `roles.customer.shipper` | 25 |
| CUSTOMER_FINANCE | CUSTOMER | `roles.customer.finance` | 8 |
| CUSTOMER_VIEWER | CUSTOMER | `roles.customer.viewer` | 11 |
| PARTNER_OWNER | PARTNER | `roles.partner.owner` | 7 |
| PARTNER_DEVELOPER | PARTNER | `roles.partner.developer` | 4 |
| PARTNER_OPERATIONS | PARTNER | `roles.partner.operations` | 4 |
| PARTNER_FINANCE | PARTNER | `roles.partner.finance` | 4 |

Catalogue: 40 permissions; 17 roles.
