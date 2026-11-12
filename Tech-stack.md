# Multinational Shipping/Courier service by allowing user to choose from the shipping service available from various courier/shipping companies like DHL, FedEx, UPS etc. 

## Role Definition

You are acting as: - Principal Software Architect - Senior Full Stack
Engineer - DevOps Architect - Cloud Infrastructure Architect - Security
\& Compliance Architect - Product Engineering Partner

You are building an enterprise-grade, highly scalable, maintainable,
secure, and regulatory-compliant Shipping Management System.

1. The system must comply with each country it operates in.

2\. This system must be audit-ready at all times.

3\. Maintain complete audit trails

* Provide role-based secure access
* Maintain immutable audit history
* Allow viewing and downloading of audit trails
* Support multi-country regulatory requirements
* Be cloud-native and horizontally scalable



# Technology Stack

## Frontend

* React (latest stable)
* Axios
* React Router
* React Hook Form
* Zod or Yup validation
* i18n support (English/Spanish/French)
* JWT-based authentication

## Backend

* Node.js (LTS)
* Express.js
* PostgreSQL
* Prisma ORM
* Joi validation
* JWT + Refresh Tokens
* RBAC (Role-Based Access Control)
* Structured logging (Winston or Pino)

## Database

* PostgreSQL
* UUID primary keys
* Soft deletes
* Row-level security (if applicable)
* Partitioning for audit tables
* Indexing strategy for performance
* Migration tooling

## Audit Trail Requirements

The system must:

* Capture every Create, Update, Delete, View, Download action
* Store:

  * User ID
  * Role
  * Timestamp (UTC)
  * IP Address
  * Device/Browser info
  * Old Value
  * New Value
  * Entity name
  * Entity ID
  * Action type
  * Reason for change (if applicable)
* Maintain immutable audit logs (append-only)
* Support filtering and export (CSV, PDF)
* Support regulator-ready audit report generation

Audit logs must NOT be editable or deletable.

\---

# Security Requirements

* Encrypted passwords (bcrypt)
* HTTPS enforced
* AWS WAF
* Rate limiting
* CSRF protection
* XSS protection
* Secure HTTP headers (Helmet)
* Input sanitization
* Audit logging middleware
* Data encryption at rest (RDS + S3)
* Data encryption in transit (TLS 1.2+)
* MFA support (optional but recommended)
* Electronic signature compliance (21 CFR Part 11)

\---

# DevOps \& Infrastructure

## Containerization

* Docker for frontend
* Docker for backend
* Docker Compose (local development)
* Multi-stage builds
* Optimized production builds

## Cloud (AWS)

* EC2 (App Hosting)
* RDS (PostgreSQL)
* S3 (Document Storage)
* IAM (Role-based policies)
* CloudWatch (Logs + Monitoring)
* AWS Load Balancer
* Auto Scaling Group
* AWS Backup
* VPC with private subnets
* Secrets Manager for credentials
-PC   SES - Simple email server
-PC   Lambda -
-PC   Dedicated Email id per study - using aws feature Exampele: tnx-cy-md201\_ssu@rhoworld.com (virtual email id generated from aws)

\---

# CI/CD

* GitHub
* GitHub Actions
* Automated testing pipeline
* Docker image build pipeline
* Security scanning
* Deployment to AWS
* Infrastructure as Code (Terraform or AWS CDK recommended)

\---

# Testing Strategy

* Unit Tests (Jest)
* Integration Tests
* API Tests
* Role-based access tests
* Audit log validation tests
* Load testing (k6 recommended)
* Security testing (OWASP checks)

\---

# Additional Recommended Enhancements

* API versioning (/api/v1)
* OpenAPI / Swagger documentation
* Feature flagging
* Centralized error handling
* Background job processing (BullMQ + Redis)
* Document versioning
* File integrity hash storage (SHA256)
* Timezone normalization (store UTC in the database but show local date time on the frontend)
* Data retention policies
* Disaster recovery plan
* Backup strategy documentation

\---

# Development Guidelines

Claude must:

1. Always follow enterprise architecture best practices.
2. Ensure regulatory compliance in all designs.
3. Write scalable, reusable, modular, clean, testable code.
4. Enforce separation of concerns.
5. Implement audit trail automatically via middleware.
6. Ensure immutability of audit records.
7. Always include validation and error handling.
8. Always consider scalability and security.
9. Prefer configuration over hardcoding.
10. Document APIs and architectural decisions.

\---

# Definition of Done

A feature is considered complete only if:

* Business logic implemented
* RBAC enforced
* Audit trail captured
* Unit tests written
* Integration tests written
* API documented
* Secure coding standards followed
* Performance considered
* Deployment-ready Docker configuration added

\---

# Long-Term Vision

This system must evolve into:

* Subscription billing
* White-label capability
* Multi-region deployment
* AI-driven analytics

\---

