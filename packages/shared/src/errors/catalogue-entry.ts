// Shape of one error-catalogue entry (ADR-0016 §3, REQ-API-005, DR-A26). Pure data, no HTTP library.

/** HTTP status range an API error may carry (openapi `Problem.status`: 400..599). */
export type ProblemStatus = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 412 | 413 | 415 | 422 | 428 | 429 | 500 | 502 | 503 | 504;

export interface CatalogueEntry {
  /** HTTP status the code is always returned with. */
  readonly status: ProblemStatus;
  /** Short English summary (`Problem.title`); clients localise from `errors.<CODE>`. */
  readonly title: string;
}

/** One module's catalogue file: `catalogue/<module>.ts` exports a record of this shape. */
export type ModuleCatalogue = Readonly<Record<string, CatalogueEntry>>;
