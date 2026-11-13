/** Supporting module of bad-tx-handle-forms.ts: a namespace import gives the qualified form `Db.AppTransactionClient`. */
export interface AppTransactionClient {
  $executeRaw(): Promise<number>;
}
